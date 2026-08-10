// persistence.js
//
// Abstracts "where do we durably store JSON blobs" so config-store.js and
// watchers-store.js don't need to know or care which backend is active:
//
//   - If DYNAMODB_TABLE is set, use DynamoDB. This is the right choice for
//     any stateless/serverless host — local disk doesn't survive redeploys
//     or restarts there.
//   - If it's not set, fall back to a local JSON file, same as before this
//     feature existed. Good for local development/testing without needing
//     any AWS account at all.
//
// On AWS-native compute (App Runner/ECS), attach an "instance role" to your
// service with dynamodb:GetItem + dynamodb:PutItem permission on your
// table. The AWS SDK picks those credentials up automatically — no keys to
// manage, leave DYNAMO_ACCESS_KEY_ID/DYNAMO_SECRET_ACCESS_KEY unset.
//
// On non-AWS hosts (Railway, Render, etc.), set DYNAMO_ACCESS_KEY_ID and
// DYNAMO_SECRET_ACCESS_KEY explicitly (see .env.example). Deliberately NOT
// named AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY — several hosts (Railway
// confirmed) inject their own internal values for those exact names, which
// silently breaks the AWS SDK's credential lookup even when you set real
// ones yourself.
//
// IMPORTANT: this DynamoDB path was written from documented SDK v3
// conventions and fixed once against a real Railway deployment issue, but
// I still can't run it myself — this sandbox has no outbound network
// access. The local-file fallback path IS fully tested.

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

  // IMPORTANT: some hosts (Railway confirmed, possibly others) inject their
  // own internal values for AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY into
  // every container, silently overriding whatever you set for those exact
  // names — the AWS SDK then fails with "Could not load credentials from
  // any providers" even though you configured real keys. To avoid that
  // collision, this app reads differently-named variables instead
  // (DYNAMO_ACCESS_KEY_ID / DYNAMO_SECRET_ACCESS_KEY) and passes them to
  // the SDK explicitly. If those aren't set, it falls back to the SDK's
  // normal default credential chain — which is what you want on AWS-native
  // compute (App Runner/ECS) using an instance role, where no explicit keys
  // are needed at all.
  const clientConfig = { region: process.env.AWS_REGION || 'us-east-1' };
  console.log(
    '[persistence] DYNAMO_ACCESS_KEY_ID present:', !!process.env.DYNAMO_ACCESS_KEY_ID,
    '| DYNAMO_SECRET_ACCESS_KEY present:', !!process.env.DYNAMO_SECRET_ACCESS_KEY,
    '| DYNAMODB_TABLE:', process.env.DYNAMODB_TABLE,
    '| AWS_REGION:', process.env.AWS_REGION
  );
  if (process.env.DYNAMO_ACCESS_KEY_ID && process.env.DYNAMO_SECRET_ACCESS_KEY) {
    clientConfig.credentials = {
      accessKeyId: process.env.DYNAMO_ACCESS_KEY_ID,
      secretAccessKey: process.env.DYNAMO_SECRET_ACCESS_KEY,
    };
  }
  const client = new DynamoDBClient(clientConfig);
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
