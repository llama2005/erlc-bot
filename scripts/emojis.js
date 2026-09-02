// List the bot application's custom emojis (name, id, animated) so the `CUSTOM`
// map in src/lib/style.js can be verified / regenerated.
//
//   node scripts/emojis.js
//
// Needs DISCORD_TOKEN and DISCORD_CLIENT_ID in the environment (.env is loaded).
import "dotenv/config";

const token = process.env.DISCORD_TOKEN;
const appId = process.env.DISCORD_CLIENT_ID;
if (!token || !appId) {
  console.error("DISCORD_TOKEN and DISCORD_CLIENT_ID must be set.");
  process.exit(1);
}

const res = await fetch(`https://discord.com/api/v10/applications/${appId}/emojis`, {
  headers: { Authorization: `Bot ${token}` },
});
if (!res.ok) {
  console.error(`GET /applications/${appId}/emojis → ${res.status} ${await res.text()}`);
  process.exit(1);
}

const { items } = await res.json();
if (!items?.length) {
  console.log("No application emojis. Upload them in the Dev Portal → your app → Emojis.");
  process.exit(0);
}

console.log(`${items.length} application emoji(s):\n`);
for (const e of items.sort((a, b) => a.name.localeCompare(b.name))) {
  const ref = e.animated ? `<a:${e.name}:${e.id}>` : `<:${e.name}:${e.id}>`;
  console.log(`  ${e.name.padEnd(20)} ${e.animated ? "[animated] " : "           "}${ref}`);
}
