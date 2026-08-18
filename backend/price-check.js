// price-check.js
//
// The actual "did the price drop" logic. Groups active watchers by event,
// re-fetches ticket prices through the same aggregation used by /api/tickets,
// and emails anyone whose watched price has gone down since we last told them.

const { handleTickets } = require('./routes/tickets');
const watchersStore = require('./watchers-store');
const registry = require('./providers/registry');

function groupByEvent(watchers) {
  const groups = {};
  for (const w of watchers) {
    if (!groups[w.eventId]) groups[w.eventId] = [];
    groups[w.eventId].push(w);
  }
  return groups;
}

async function runPriceCheck() {
  const env = registry.getMergedEnv();
  const active = watchersStore.getActive();
  if (active.length === 0) return { checked: 0, notified: 0 };

  const groups = groupByEvent(active);
  const emailProvider = registry.getActiveEmailProvider(env);
  let notified = 0;

  for (const eventId of Object.keys(groups)) {
    const group = groups[eventId];
    const sample = group[0];

    let ticketData;
    try {
      ticketData = await handleTickets(
        { artist: sample.artist, city: sample.city, basePrice: sample.initialPrice, eventId },
        env
      );
    } catch (err) {
      console.warn(`[price-check] Failed to fetch prices for event ${eventId}:`, err.message);
      continue;
    }

    const lowest = ticketData.results && ticketData.results[0] ? ticketData.results[0].total : null;
    if (lowest == null) continue;

    for (const w of group) {
      watchersStore.updateAfterCheck(w.id, lowest);
      const threshold = w.lastNotifiedPrice ?? w.initialPrice;
      if (lowest < threshold) {
        const unsubUrl = `/unsubscribe?id=${w.id}&token=${w.unsubscribeToken}`;
        await emailProvider.send(
          {
            to: w.email,
            subject: `Price drop: ${w.artist} in ${w.city} is now $${lowest.toFixed(2)}`,
            text: `Good news — ${w.artist} at ${w.venue}, ${w.city} just dropped to $${lowest.toFixed(2)} (was $${threshold.toFixed(2)} when you signed up).\n\nSee it: ${w.eventUrl}\n\nStop these alerts: ${unsubUrl}`,
            html: `<p>Good news — <strong>${w.artist}</strong> at ${w.venue}, ${w.city} just dropped to <strong>$${lowest.toFixed(2)}</strong> (was $${threshold.toFixed(2)} when you signed up).</p><p><a href="${w.eventUrl}">See it</a></p><p style="font-size:12px;color:#888;">Don't want these? <a href="${unsubUrl}">Unsubscribe</a></p>`,
          },
          env
        );
        watchersStore.markNotified(w.id, lowest);
        notified++;
      }
    }
  }

  return { checked: active.length, notified, demoMode: emailProvider.id === 'demo' };
}

module.exports = { runPriceCheck };
