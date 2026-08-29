// Public Roblox web APIs — no auth. Sub-calls degrade to null on failure/rate-limit.

async function getJSON(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`Roblox ${res.status} for ${url}`);
  return res.json();
}

export async function userByUsername(username) {
  const data = await getJSON("https://users.roblox.com/v1/usernames/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ usernames: [username], excludeBannedUsers: false }),
  });
  return data.data?.[0] ?? null;
}

export const userById = (id) => getJSON(`https://users.roblox.com/v1/users/${id}`);

/** Batch id -> { id, name, displayName }. Returns a Map; empty on failure. */
export async function usersByIds(ids) {
  const out = new Map();
  if (!ids?.length) return out;
  const data = await getJSON("https://users.roblox.com/v1/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userIds: ids.map(Number), excludeBannedUsers: false }),
  }).catch(() => null);
  for (const u of data?.data ?? []) out.set(String(u.id), u);
  return out;
}

export async function headshotUrl(id) {
  const d = await getJSON(
    `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${id}&size=420x420&format=Png&isCircular=false`,
  ).catch(() => null);
  return d?.data?.[0]?.imageUrl ?? null;
}

const countOr = (url) =>
  getJSON(url)
    .then((d) => d.count)
    .catch(() => null);

export const friendCount = (id) => countOr(`https://friends.roblox.com/v1/users/${id}/friends/count`);
export const followerCount = (id) => countOr(`https://friends.roblox.com/v1/users/${id}/followers/count`);
export const followingCount = (id) => countOr(`https://friends.roblox.com/v1/users/${id}/followings/count`);

export const groups = (id) =>
  getJSON(`https://groups.roblox.com/v2/users/${id}/groups/roles`)
    .then((d) => d.data ?? [])
    .catch(() => []);

export async function presence(ids) {
  const d = await getJSON("https://presence.roblox.com/v1/presence/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userIds: ids }),
  }).catch(() => null);
  return d?.userPresences ?? [];
}

/** Full profile lookup by username or numeric ID. Returns null if the user doesn't exist. */
export async function lookup(input) {
  const raw = String(input).trim().replace(/^@/, "");
  let base;
  if (/^\d{2,}$/.test(raw)) {
    base = await userById(raw).catch(() => null);
  } else {
    const hit = await userByUsername(raw);
    base = hit ? await userById(hit.id).catch(() => hit) : null;
  }
  if (!base) return null;

  const [headshot, friends, followers, following, grps, pres] = await Promise.all([
    headshotUrl(base.id),
    friendCount(base.id),
    followerCount(base.id),
    followingCount(base.id),
    groups(base.id),
    presence([base.id]),
  ]);

  return {
    id: base.id,
    name: base.name,
    displayName: base.displayName,
    description: base.description || "",
    created: base.created,
    isBanned: !!base.isBanned,
    hasVerifiedBadge: !!base.hasVerifiedBadge,
    headshot,
    friends,
    followers,
    following,
    groups: grps,
    presence: pres[0] ?? null,
    profileUrl: `https://www.roblox.com/users/${base.id}/profile`,
  };
}

export const PRESENCE_TYPES = ["Offline", "Online", "In Game", "In Studio"];
