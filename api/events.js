const https = require("https");

const REGIONS = [
  { name: "SF Bay Area",     url: "https://19hz.info/eventlisting_BayArea.php" },
  { name: "Los Angeles",     url: "https://19hz.info/eventlisting_LosAngeles.php" },
  { name: "Seattle",         url: "https://19hz.info/eventlisting_Seattle.php" },
  { name: "Chicago",         url: "https://19hz.info/eventlisting_CHI.php" },
  { name: "Miami",           url: "https://19hz.info/eventlisting_Miami.php" },
  { name: "Washington DC",   url: "https://19hz.info/eventlisting_DC.php" },
  { name: "Denver",          url: "https://19hz.info/eventlisting_Denver.php" },
  { name: "Texas",           url: "https://19hz.info/eventlisting_Texas.php" },
  { name: "Atlanta",         url: "https://19hz.info/eventlisting_Atlanta.php" },
  { name: "Detroit",         url: "https://19hz.info/eventlisting_Detroit.php" },
  { name: "Massachusetts",   url: "https://19hz.info/eventlisting_Massachusetts.php" },
  { name: "Phoenix",         url: "https://19hz.info/eventlisting_Phoenix.php" },
  { name: "Portland",        url: "https://19hz.info/eventlisting_ORE.php" },
  { name: "Vancouver",       url: "https://19hz.info/eventlisting_BC.php" },
  { name: "Toronto",         url: "https://19hz.info/eventlisting_Toronto.php" },
  { name: "Iowa / Nebraska", url: "https://19hz.info/eventlisting_Iowa.php" },
];

function fetchHTML(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => resolve(data));
    }).on("error", reject);
  });
}

function stripTags(s) {
  return (s || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstHref(s) {
  const m = (s || "").match(/href='([^']+)'/) || (s || "").match(/href="([^"]+)"/);
  return m ? m[1] : "";
}

function parseEvents(html, regionName) {
  const events = [];
  const today = new Date(); today.setHours(0, 0, 0, 0);

  // Each event row has <div class='shrink'>YYYY/MM/DD</div> as the date marker
  // Row columns: 0=datetime, 1=title@venue, 2=genres, 3=price|age, 4=organizers, 5=links, 6=date
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;

  while ((rowMatch = rowRe.exec(html)) !== null) {
    const rowHTML = rowMatch[1];

    // Must have a shrink date div
    const dateMatch = rowHTML.match(/<div[^>]*class=['"]shrink['"][^>]*>(\d{4}\/\d{2}\/\d{2})<\/div>/);
    if (!dateMatch) continue;

    const dateStr = dateMatch[1].replace(/\//g, "-");
    const [yr, mo, dy] = dateStr.split("-").map(Number);

    // Get all TD contents
    const tds = [];
    const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let tdMatch;
    while ((tdMatch = tdRe.exec(rowHTML)) !== null) {
      tds.push(tdMatch[1]);
    }
    if (tds.length < 4) continue;

    // td[0]: time e.g. "Thu: May 21 <br/>(9pm-2am)"
    const timeText = stripTags(tds[0]);
    const timeMatch = timeText.match(/\(([^)]+)\)/);
    const time = timeMatch ? timeMatch[1] : "";

    // td[1]: <a href='URL'>Title</a> @ Venue (City)
    const cell1 = tds[1];
    const url = firstHref(cell1);
    const raw1 = stripTags(cell1);
    const atIdx = raw1.indexOf(" @ ");
    const title = atIdx > -1 ? raw1.substring(0, atIdx).trim() : raw1.trim();
    const venueRaw = atIdx > -1 ? raw1.substring(atIdx + 3).trim() : "";

    // td[2]: genres OR price (depends on row type)
    // td[3]: price|age OR organizers
    // We detect which by checking if td[2] contains a $ or "free"
    let venue = venueRaw;
    let tags = "";
    let price = "";
    let age = "";

    const td2 = stripTags(tds[2] || "");
    const td3 = stripTags(tds[3] || "");

    const isPricelike = (s) => /^\$|^free|^tba|^sold/i.test(s.trim());

    if (isPricelike(td2)) {
      // td2 = price, td3 = organizers — genres were in venue field, split them out
      // Venue ends at last closing paren e.g. "Venue Name (City) genre, genre"
      const parenEnd = venueRaw.lastIndexOf(")");
      if (parenEnd > -1 && parenEnd < venueRaw.length - 1) {
        venue = venueRaw.substring(0, parenEnd + 1).trim();
        tags = venueRaw.substring(parenEnd + 1).trim().replace(/^[,\s]+/, "");
      }
      const pipeIdx = td2.indexOf("|");
      price = pipeIdx > -1 ? td2.substring(0, pipeIdx).trim() : td2.trim();
      age = pipeIdx > -1 ? td2.substring(pipeIdx + 1).trim() : "";
    } else {
      // td2 = genres, td3 = price|age (normal layout)
      tags = td2;
      const pipeIdx = td3.indexOf("|");
      price = pipeIdx > -1 ? td3.substring(0, pipeIdx).trim() : td3.trim();
      age = pipeIdx > -1 ? td3.substring(pipeIdx + 1).trim() : "";
    }

    // alt link from td[5] if no primary url
    const altUrl = tds[5] ? firstHref(tds[5]) : "";
    const finalUrl = url || altUrl || "";

    if (!title || title.length < 2) continue;

    events.push({ title, venue, tags, price, age, time, date: dateStr, region: regionName, url: finalUrl });
  }

  return events;
}

let cache = { data: null, fetchedAt: 0 };
const CACHE_TTL = 6 * 60 * 60 * 1000;

async function getAllEvents(forceRefresh) {
  const now = Date.now();
  if (!forceRefresh && cache.data && now - cache.fetchedAt < CACHE_TTL) {
    return cache.data;
  }
  const allEvents = [];
  for (const region of REGIONS) {
    try {
      const html = await fetchHTML(region.url);
      const events = parseEvents(html, region.name);
      console.log(`${region.name}: ${events.length}`);
      allEvents.push(...events);
    } catch (err) {
      console.error(`Failed ${region.name}:`, err.message);
    }
  }
  cache = { data: allEvents, fetchedAt: now };
  return allEvents;
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");
  const forceRefresh = req.query && req.query.refresh === "1";
  try {
    const events = await getAllEvents(forceRefresh);
    res.status(200).json({
      ok: true,
      fetchedAt: new Date(cache.fetchedAt).toISOString(),
      count: events.length,
      events,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
};
