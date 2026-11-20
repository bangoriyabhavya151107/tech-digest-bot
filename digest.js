const GROQ_API_KEY = process.env.GROQ_API_KEY;
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;

if (!GROQ_API_KEY || !DISCORD_BOT_TOKEN || !DISCORD_CHANNEL_ID) {
  console.error("Missing required environment variables.");
  process.exit(1);
}

async function runDigest() {
  // 1. Calculate date 7 days ago (YYYY-MM-DD)
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];

  console.log(`Fetching GitHub repos created after ${sevenDaysAgo} and HN front page...`);

  // 2. Fetch GitHub and Hacker News in parallel
  const [ghRes, hnRes] = await Promise.all([
    fetch(
      `https://api.github.com/search/repositories?q=created:>${sevenDaysAgo}&sort=stars&order=desc&per_page=6`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "TechDigestAI-Bot",
        },
      }
    ),
    fetch("https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=8"),
  ]);

  if (!ghRes.ok) throw new Error(`GitHub API error: ${ghRes.status}`);
  if (!hnRes.ok) throw new Error(`Hacker News API error: ${hnRes.status}`);

  const ghData = await ghRes.json();
  const hnData = await hnRes.json();

  // 3. Clean data (same logic as your n8n JavaScript node)
  const topRepos = (ghData.items || []).slice(0, 5).map((repo) => ({
    name: repo.full_name,
    stars: repo.stargazers_count,
    language: repo.language || "Multi-language",
    description: repo.description || "No description provided",
    topics: (repo.topics || []).slice(0, 4).join(", "),
    url: repo.html_url,
  }));

  const topInnovations = (hnData.hits || [])
    .filter((story) => story.url)
    .slice(0, 5)
    .map((story) => ({
      title: story.title,
      points: story.points,
      comments: story.num_comments,
      url: story.url,
      hnDiscussion: `https://news.ycombinator.com/item?id=${story.objectID}`,
    }));

  // 4. Send to Groq AI (openai/gpt-oss-120b)
  console.log("Generating digest with Groq AI...");
  const prompt = `You are a Senior Staff Engineer curating a high-signal Daily Tech & Open-Source Digest for Discord.

Analyze today's trending GitHub repositories and Hacker News innovations:
GitHub Repos: ${JSON.stringify(topRepos)}
Tech Innovations: ${JSON.stringify(topInnovations)}

Create a clean, Discord-formatted briefing under 1,900 characters (so it fits Discord's message limit) with:
1. 🏆 **REPO OF THE DAY**: Pick the single most useful or innovative GitHub repo. State its name, star count, primary language, the exact engineering problem it solves, and a clickable link.
2. ⚡ **3 RUNNER-UP REPOS**: One bullet each with repo link, stars, language, and a 1-sentence takeaway.
3. 💡 **BEST TECH SOLUTION / INNOVATION TODAY**: Pick the top 2 engineering breakthroughs or tools from the Hacker News list, explain why they matter to a developer, and link both the article and HN discussion.
4. 💬 End with a 1-line prompt reminding me what technical question I could ask you about today's picks.`;

  const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/gpt-oss-120b",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
    }),
  });

  if (!groqRes.ok) {
    const errText = await groqRes.text();
    throw new Error(`Groq API error (${groqRes.status}): ${errText}`);
  }

  const groqData = await groqRes.json();
  let digestMessage = groqData.choices?.[0]?.message?.content?.trim();

  if (!digestMessage) throw new Error("Groq returned an empty response.");

  // Safety check for Discord's 2,000-character limit
  if (digestMessage.length > 1990) {
    digestMessage = digestMessage.slice(0, 1987) + "...";
  }

  // 5. Post to Discord using your TechDigestAi Bot Token
  console.log("Sending digest to Discord...");
  const discordRes = await fetch(
    `https://discord.com/api/v10/channels/${DISCORD_CHANNEL_ID}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content: digestMessage }),
    }
  );

  if (!discordRes.ok) {
    const errText = await discordRes.text();
    throw new Error(`Discord API error (${discordRes.status}): ${errText}`);
  }

  console.log("Daily Tech Digest sent to Discord successfully!");
}

runDigest().catch((err) => {
  console.error("Workflow failed:", err);
  process.exit(1);
});