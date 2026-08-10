// persistence.js
//
// Abstracts "where do we durably store JSON blobs" so config-store.js and
// watchers-store.js don't need to know or care which backend is active:
//
//   - If DYNAMODB_TABLE is set, use DynamoDB. This is the right choice for
//     App Runner (and any stateless/serverless host) — local disk doesn't
//     survive redeploys or restarts there.
//   - If it's not set, fall back to a local JSON file, same as before this
//     feature existed. Good for local development/testing without needing
//     any AWS account at all.
//
// On App Runner, attach an "instance role" (not the build role) to your
// service with dynamodb:GetItem + dynamodb:PutItem permission on your table.
// The AWS SDK picks those credentials up automatically — no access keys to
// manage. Locally, if you want to test against real DynamoDB, set
// AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_REGION as usual for the
// AWS SDK's default credential chain, or just leave DYNAMODB_TABLE unset
// and use the local file instead.
//
// IMPORTANT: this DynamoDB path was written from documented SDK v3
// conventions, not tested against a live table — this sandbox has no
// outbound network access. Verify it against a real table before depending
// on it in production. The local-file fallback path IS tested (it's the
// same code this project used before).

const fs = require('fs');
const path = require('path');

const useDynamo = !!process.env.DYNAMODB_TABLE;
const TABLE_NAME = process.env.DYNAMODB_TABLE;
const DATA_DIR = path.join(__dirname, 'data');

let ddbDocClient = null;
function getDynamoClient() {
  if (ddbDocClient) return ddbDocClient;
  // Lazy-required so this file — and everything that requires it — still
  // loads fine even if @aws-sdk isn't installed, as long as DynamoDB mode
  // isn't actually being used (e.g. local dev without DYNAMODB_TABLE set).
  const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
  const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
  const client = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
  ddbDocClient = DynamoDBDocumentClient.from(client);
  return ddbDocClient;
}

function localPath(id) {
  return path.join(DATA_DIR, `${id}.json`);
}

async function loadState(id, defaultValue) {
  if (useDynamo) {
    try {
      const { GetCommand } = require('@aws-sdk/lib-dynamodb');
      const result = await getDynamoClient().send(
        new GetCommand({ TableName: TABLE_NAME, Key: { id } })
      );
      return result.Item ? result.Item.data : defaultValue;
    } catch (err) {
      console.error(`[persistence] Failed to load "${id}" from DynamoDB, using default:`, err.message);
      return defaultValue;
    }
  }
  const filePath = localPath(id);
  if (!fs.existsSync(filePath)) return defaultValue;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    console.warn(`[persistence] Could not parse ${filePath}, using default:`, e.message);
    return defaultValue;
  }
}

async function saveState(id, data) {
  if (useDynamo) {
    try {
      const { PutCommand } = require('@aws-sdk/lib-dynamodb');
      await getDynamoClient().send(
        new PutCommand({ TableName: TABLE_NAME, Item: { id, data, updatedAt: new Date().toISOString() } })
      );
    } catch (err) {
      console.error(`[persistence] Failed to save "${id}" to DynamoDB:`, err.message);
    }
    return;
  }
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(localPath(id), JSON.stringify(data, null, 2));
}

module.exports = { loadState, saveState, isUsingDynamo: () => useDynamo };
