// verify-videos.mjs   run: node verify-videos.mjs
import fs from "node:fs";
import "dotenv/config";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const KEY = process.env.YOUTUBE_API_KEY;
if (!KEY?.trim()) {
  console.error("Missing YOUTUBE_API_KEY. Set it in the environment or .env file.");
  process.exit(1);
}

const API = "https://www.googleapis.com/youtube/v3";
const REGION = "IN"; // your viewers' region
const MIN_SEC = 120;
const MAX_SEC = 1800;

// ---------------------------------------------------------------------------
// Module catalogue
// [course, title, search query, required, audience, conditions, due, repeat]
// ---------------------------------------------------------------------------

const M = [
  // Workplace Safety
  ["Workplace Safety","Fire Safety Basics","workplace fire safety training","Yes","Manufacturing employees","Match all â€” Manufacturing domain and Site location","30 days after assignment","Annually"],
  ["Workplace Safety","PPE Safety","personal protective equipment PPE workplace safety training","Yes","Manufacturing employees","Match all â€” Manufacturing domain and Site location","30 days after assignment","Annually"],
  ["Workplace Safety","Slips, Trips and Falls","slips trips and falls workplace safety training","Yes","Site employees","Match any â€” Site location or Operations domain","45 days after assignment","Annually"],
  ["Workplace Safety","Ergonomics","office ergonomics workstation setup training","Yes","All employees","Match any â€” Any domain","60 days after assignment","Every 2 years"],
  ["Workplace Safety","Emergency Response","workplace emergency response evacuation procedures training","Yes","Site employees","Match any â€” Site location or New joiner group","30 days after assignment","Annually"],

  // Information Security
  ["Information Security","Password Security","password security best practices employees","Yes","All employees","Match any â€” Any domain","14 days after assignment","Annually"],
  ["Information Security","Phishing Awareness","phishing awareness training employees","Yes","All employees","Match any â€” Any domain","14 days after assignment","Every 6 months"],
  ["Information Security","Multi-Factor Authentication","multi-factor authentication explained MFA","Yes","IT employees","Match all â€” IT domain and Employee level L2 or above","30 days after assignment","Annually"],
  ["Information Security","Social Engineering","social engineering attacks awareness training","Yes","Customer-facing employees","Match any â€” Support domain or Sales domain","30 days after assignment","Annually"],
  ["Information Security","Malware and Safe Browsing","malware safe browsing security awareness","Yes","All employees","Match any â€” Any domain","30 days after assignment","Annually"],

  // Code of Conduct
  ["Code of Conduct","Workplace Ethics","workplace ethics training employees","Yes","New joiners","Match any â€” New joiner group or employee level L1","15 days after assignment","Annually"],
  ["Code of Conduct","Conflict of Interest","conflict of interest workplace training","Yes","Managers","Match all â€” Manager designation and Employee level L3 or above","30 days after assignment","Annually"],
  ["Code of Conduct","Anti-Bribery and Corruption","anti-bribery and corruption training employees","Yes","Finance employees","Match any â€” Finance domain or Procurement domain","30 days after assignment","Annually"],
  ["Code of Conduct","Respectful Workplace Behaviour","respectful workplace behavior harassment prevention training","Yes","All employees","Match any â€” Any domain","30 days after assignment","Annually"],
  ["Code of Conduct","Reporting Concerns","speak up whistleblowing reporting concerns workplace","Yes","All employees","Match any â€” Any domain","30 days after assignment","Annually"],

  // Privacy Essentials
  ["Privacy Essentials","What Is Personal Data","what is personal data GDPR explained","Yes","All employees","Match any â€” Any domain","30 days after assignment","Annually"],
  ["Privacy Essentials","Privacy Principles","GDPR data protection principles explained","Yes","Employees handling personal data","Match all â€” Data handler group and Employee level L2 or above","30 days after assignment","Annually"],
  ["Privacy Essentials","Data Minimisation","data minimisation principle explained","Yes","Employees handling personal data","Match any â€” HR domain or Support domain or Data handler group","45 days after assignment","Annually"],
  ["Privacy Essentials","Lawful Processing","lawful basis for processing personal data explained","Yes","HR employees","Match all â€” HR domain and Employee level L2 or above","45 days after assignment","Annually"],
  ["Privacy Essentials","Privacy Responsibilities","employee data protection responsibilities training","Yes","Team leads","Match all â€” Team lead designation and Data handler group","30 days after assignment","Annually"],

  // Incident Response
  ["Incident Response","Security Incidents","what is a security incident explained","Yes","All employees","Match any â€” Any domain","30 days after assignment","Annually"],
  ["Incident Response","Incident Identification","identifying security incidents indicators of compromise","Yes","IT employees","Match any â€” IT domain or Security team","30 days after assignment","Annually"],
  ["Incident Response","Incident Reporting","how to report a security incident employees","Yes","All employees","Match any â€” Any domain","30 days after assignment","Annually"],
  ["Incident Response","Containment","incident response containment eradication recovery","Yes","Security team","Match all â€” Security domain and Responder role","30 days after assignment","Annually"],
  ["Incident Response","Post-Incident Review","post-incident review lessons learned incident response","Yes","Security team","Match all â€” Security domain and Employee level L3 or above","45 days after assignment","Annually"],

  // Secure Development
  ["Secure Development","OWASP Top 10","OWASP Top 10 explained developers","Yes","Software developers","Match all â€” Engineering department and Developer role","30 days after assignment","Annually"],
  ["Secure Development","Secure Coding Practices","secure coding practices developers","Yes","Software developers","Match all â€” Engineering department and Developer role","30 days after assignment","Annually"],
  ["Secure Development","Input Validation","input validation injection prevention secure coding","Yes","Software developers","Match all â€” Engineering department and Developer role","45 days after assignment","Annually"],
  ["Secure Development","Authentication and Authorization","authentication vs authorization explained developers","Yes","Engineering team","Match any â€” Backend role or Security team","45 days after assignment","Annually"],
  ["Secure Development","Secure Code Review","secure code review process security","Yes","Team leads","Match all â€” Engineering department and Team lead designation","45 days after assignment","Annually"],

  // Quality Management
  ["Quality Management","Quality Management Fundamentals","quality management fundamentals introduction","Yes","Operations employees","Match any â€” Operations domain or Manufacturing domain","30 days after assignment","Every 2 years"],
  ["Quality Management","Quality Standards","ISO 9001 explained quality management system","Yes","Operations employees","Match all â€” Operations domain and Employee level L2 or above","45 days after assignment","Every 2 years"],
  ["Quality Management","Process Control","statistical process control explained","Yes","Manufacturing employees","Match all â€” Manufacturing domain and Site location","45 days after assignment","Annually"],
  ["Quality Management","Root Cause Analysis","root cause analysis 5 whys fishbone","Yes","Team leads","Match any â€” Operations domain or Manufacturing domain","60 days after assignment","Every 2 years"],
  ["Quality Management","Continuous Improvement","continuous improvement PDCA explained","No","Managers","Match any â€” Operations domain or Quality domain","60 days after assignment","Every 2 years"],

  // Customer Care
  ["Customer Care","Customer Service Fundamentals","customer service fundamentals training","Yes","Customer-facing employees","Match any â€” Support domain or Sales domain","30 days after assignment","Annually"],
  ["Customer Care","Active Listening","active listening skills customer service","Yes","Customer-facing employees","Match any â€” Support domain or Sales domain","30 days after assignment","Annually"],
  ["Customer Care","Customer Communication","customer communication skills training","Yes","New joiners","Match all â€” New joiner group and Support domain","15 days after assignment","One-time"],
  ["Customer Care","Complaint Handling","handling customer complaints training","Yes","Customer-facing employees","Match all â€” Support domain and Employee level L1 or above","30 days after assignment","Annually"],
  ["Customer Care","Handling Difficult Customers","dealing with difficult customers training","Yes","Customer-facing employees","Match all â€” Support domain and Employee level L2 or above","45 days after assignment","Annually"],

  // Operational Excellence
  ["Operational Excellence","Operational Excellence Overview","operational excellence explained","Yes","Operations employees","Match any â€” Operations domain or Manufacturing domain","45 days after assignment","Every 2 years"],
  ["Operational Excellence","Lean Thinking","lean thinking principles explained","Yes","Operations employees","Match any â€” Operations domain or Manufacturing domain","45 days after assignment","Every 2 years"],
  ["Operational Excellence","5S Workplace Organisation","5S lean workplace organization explained","Yes","Manufacturing employees","Match all â€” Manufacturing domain and Site location","30 days after assignment","Annually"],
  ["Operational Excellence","Kaizen","kaizen continuous improvement explained","No","Team leads","Match any â€” Operations domain or Manufacturing domain","60 days after assignment","Every 2 years"],
  ["Operational Excellence","Waste Reduction","lean 8 wastes explained","Yes","Operations employees","Match any â€” Operations domain or Manufacturing domain","45 days after assignment","Annually"],

  // Data Handling
  ["Data Handling","Data Classification","data classification explained security training","Yes","All employees","Match any â€” Any domain","30 days after assignment","Annually"],
  ["Data Handling","Handling Sensitive Data","handling sensitive data employees security awareness","Yes","Employees handling confidential information","Match any â€” Finance domain or HR domain or Confidential data group","30 days after assignment","Annually"],
  ["Data Handling","Secure File Sharing","secure file sharing best practices","Yes","All employees","Match any â€” Any domain","30 days after assignment","Annually"],
  ["Data Handling","Data Retention","data retention policy explained","Yes","Employees handling confidential information","Match all â€” Confidential data group and Employee level L2 or above","45 days after assignment","Annually"],
  ["Data Handling","Secure Disposal","secure data disposal media sanitization","Yes","IT employees","Match any â€” IT domain or Facilities domain","45 days after assignment","Annually"],

  // Leadership Basics
  ["Leadership Basics","Leadership Fundamentals","leadership fundamentals new managers","Yes","Managers","Match any â€” Manager designation or employee level L3 or above","60 days after assignment","One-time"],
  ["Leadership Basics","Leadership Communication","leadership communication skills","Yes","Team leads","Match all â€” Team lead designation and Employee level L2 or above","60 days after assignment","One-time"],
  ["Leadership Basics","Delegation","how to delegate effectively managers","Yes","Team leads","Match all â€” Team lead designation and Employee level L2 or above","60 days after assignment","One-time"],
  ["Leadership Basics","Giving Feedback","how to give effective feedback managers","Yes","Managers","Match any â€” Manager designation or Team lead designation","60 days after assignment","Every 2 years"],
  ["Leadership Basics","Decision Making","decision making framework leaders","No","Managers","Match all â€” Manager designation and Employee level L3 or above","90 days after assignment","One-time"],

  // Business Continuity
  ["Business Continuity","Business Continuity Fundamentals","business continuity management explained","Yes","Managers","Match any â€” Operations domain or Manager designation","45 days after assignment","Annually"],
  ["Business Continuity","Business Impact Analysis","business impact analysis explained","Yes","Operations employees","Match all â€” Operations domain and Employee level L3 or above","60 days after assignment","Annually"],
  ["Business Continuity","Disaster Recovery","disaster recovery planning explained","Yes","IT employees","Match all â€” IT domain and Infrastructure role","45 days after assignment","Annually"],
  ["Business Continuity","RTO and RPO","RTO RPO explained disaster recovery","Yes","IT employees","Match any â€” IT domain or Infrastructure role","45 days after assignment","Annually"],
  ["Business Continuity","Testing and Maintenance","business continuity plan testing exercises","Yes","Operations employees","Match any â€” Operations domain or IT domain","60 days after assignment","Annually"],

  // Financial Controls
  ["Financial Controls","Internal Controls","internal controls explained accounting","Yes","Finance employees","Match all â€” Finance domain and Employee level L1 or above","30 days after assignment","Annually"],
  ["Financial Controls","Segregation of Duties","segregation of duties explained","Yes","Finance employees","Match all â€” Finance domain and Employee level L2 or above","30 days after assignment","Annually"],
  ["Financial Controls","Reconciliation","account reconciliation explained","Yes","Finance employees","Match all â€” Finance domain and Accounting role","30 days after assignment","Annually"],
  ["Financial Controls","Fraud Prevention","workplace fraud prevention training","Yes","Finance employees","Match any â€” Finance domain or Procurement domain","30 days after assignment","Annually"],
  ["Financial Controls","Audit Readiness","audit readiness preparing for an audit","Yes","Managers","Match all â€” Finance domain and Manager designation","45 days after assignment","Annually"],

  // Inclusive Workplace
  ["Inclusive Workplace","Diversity and Inclusion","diversity and inclusion in the workplace training","Yes","All employees","Match any â€” Any domain","30 days after assignment","Every 2 years"],
  ["Inclusive Workplace","Unconscious Bias","unconscious bias workplace training","Yes","HR employees","Match any â€” HR domain or Recruiter role","30 days after assignment","Annually"],
  ["Inclusive Workplace","Inclusive Communication","inclusive communication workplace","Yes","All employees","Match any â€” Any domain","45 days after assignment","Every 2 years"],
  ["Inclusive Workplace","Respectful Collaboration","respectful collaboration diverse teams","Yes","Team leads","Match any â€” Team lead designation or Manager designation","45 days after assignment","Every 2 years"],
  ["Inclusive Workplace","Building an Inclusive Culture","building an inclusive workplace culture","No","Managers","Match all â€” Manager designation and Employee level L3 or above","60 days after assignment","Every 2 years"],

  // Environmental Awareness
  ["Environmental Awareness","Environmental Responsibility","corporate environmental responsibility employees","Yes","All employees","Match any â€” Any domain","60 days after assignment","Every 2 years"],
  ["Environmental Awareness","Waste Reduction and Recycling","workplace waste reduction recycling","Yes","Site employees","Match any â€” Site location or Facilities domain","45 days after assignment","Annually"],
  ["Environmental Awareness","Energy Conservation","energy conservation in the workplace","Yes","Site employees","Match any â€” Site location or Facilities domain","45 days after assignment","Annually"],
  ["Environmental Awareness","Sustainable Workplace","sustainable workplace office sustainability","No","All employees","Match any â€” Any domain","60 days after assignment","Every 2 years"],
  ["Environmental Awareness","Climate Impact","climate change impact explained","No","All employees","Match any â€” Any domain","90 days after assignment","One-time"],
];

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const cacheFile = "docs/.course-video-search-cache.json";
const cache = fs.existsSync(cacheFile)
  ? JSON.parse(fs.readFileSync(cacheFile, "utf8"))
  : {};

const used = new Set();
const out = [];
const table = [];
const missing = [];
const records = [];

// ---------------------------------------------------------------------------
// YouTube API
// ---------------------------------------------------------------------------

async function api(path, params) {
  const url = `${API}/${path}?${new URLSearchParams({ ...params, key: KEY })}`;

  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  } catch (error) {
    throw new Error(
      `${path}: network request failed (${error.cause?.code || error.name || "unknown error"})`
    );
  }

  let json;
  try {
    json = await res.json();
  } catch {
    throw new Error(
      `${path}: YouTube API returned an unreadable response (HTTP ${res.status})`
    );
  }

  if (!res.ok) {
    const apiError = json?.error;
    const reasons =
      apiError?.errors?.map((item) => item.reason).filter(Boolean) || [];
    const reason = [...new Set(reasons)].join(", ") || "unknown API error";
    const message = String(apiError?.message || "request rejected").replaceAll(
      KEY,
      "[redacted]"
    );
    throw new Error(
      `${path}: YouTube API HTTP ${res.status} (${reason}): ${message}`
    );
  }

  return json;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseISO(d) {
  const m =
    d.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/) || [];
  const [, dd, h, mi, s] = m;
  return (
    Number(dd || 0) * 86400 +
    Number(h || 0) * 3600 +
    Number(mi || 0) * 60 +
    Number(s || 0)
  );
}

function fmt(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const parts = [];

  if (h) parts.push(`${h} hour${h > 1 ? "s" : ""}`);
  if (m) parts.push(`${m} minute${m > 1 ? "s" : ""}`);
  if (s) parts.push(`${s} second${s > 1 ? "s" : ""}`);

  return parts.join(" ") || "0 seconds";
}

function cleanText(value) {
  return value
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u00e2\u20ac[\u201c\u201d]/g, "-")
    .replace(/\u2019/g, "'")
    .replace(/\u00e2\u20ac\u2122/g, "'");
}

function regionOk(cd) {
  const r = cd.regionRestriction;
  if (!r) return true;
  if (r.blocked?.includes(REGION)) return false;
  if (r.allowed && !r.allowed.includes(REGION)) return false;
  return true;
}

function authoritativeHint(course) {
  if (course === "Workplace Safety" || course === "Environmental Awareness") {
    return "OSHA NIOSH";
  }
  if (course === "Privacy Essentials" || course === "Inclusive Workplace") {
    return "ICO university";
  }
  if (course === "Secure Development") {
    return "OWASP";
  }
  if (
    [
      "Information Security",
      "Incident Response",
      "Data Handling",
      "Business Continuity",
    ].includes(course)
  ) {
    return "CISA NIST";
  }
  if (["Financial Controls", "Anti-Bribery and Corruption"].includes(course)) {
    return "ACFE university";
  }
  return "university professional training";
}

function atomicWrite(path, content) {
  const temporaryPath = `${path}.tmp`;
  fs.writeFileSync(temporaryPath, content, "utf8");
  fs.renameSync(temporaryPath, path);
}

// ---------------------------------------------------------------------------
// Search and verification
// ---------------------------------------------------------------------------

async function searchIds(query) {
  const result = await api("search", {
    part: "snippet",
    type: "video",
    q: query,
    maxResults: 10,
    videoEmbeddable: "true",
    videoSyndicated: "true",
    relevanceLanguage: "en",
    safeSearch: "strict",
  });

  const ids = [
    ...new Set(
      (result.items || []).map((item) => item.id?.videoId).filter(Boolean)
    ),
  ];

  cache[query] = ids;
  atomicWrite(cacheFile, JSON.stringify(cache, null, 2));
  return ids;
}

async function verifiedPick(queries) {
  for (const query of queries) {
    let ids = Array.isArray(cache[query]) ? cache[query] : null;
    if (!ids) ids = await searchIds(query);

    ids = [...new Set(ids)].filter((id) => !used.has(id));
    if (!ids.length) continue;

    for (let offset = 0; offset < ids.length; offset += 50) {
      const batch = ids.slice(offset, offset + 50);
      const result = await api("videos", {
        part: "snippet,contentDetails,status",
        id: batch.join(","),
      });

      const pick = (result.items || []).find((video) => {
        const duration = video.contentDetails?.duration;
        const seconds = typeof duration === "string" ? parseISO(duration) : 0;

        return (
          video.status?.privacyStatus === "public" &&
          video.status?.uploadStatus === "processed" &&
          video.status?.embeddable === true &&
          regionOk(video.contentDetails || {}) &&
          seconds >= MIN_SEC &&
          seconds <= MAX_SEC
        );
      });

      if (pick) return { pick, query };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function run() {
  for (const [course, title, q, req, aud, cond, due, rep] of M) {
    try {
      const result = await verifiedPick([
        q,
        `${q} ${authoritativeHint(course)}`,
      ]);

      if (!result) {
        delete cache[q];
        atomicWrite(cacheFile, JSON.stringify(cache, null, 2));
        missing.push(`${course} / ${title}`);
        continue;
      }

      const { pick, query } = result;
      used.add(pick.id);

      const durationSeconds = parseISO(pick.contentDetails.duration);
      const duration = fmt(durationSeconds);
      const url = `https://www.youtube.com/watch?v=${pick.id}`;
      const cleanConditions = cleanText(cond);
      const cleanVideoTitle = cleanText(pick.snippet.title.replace(/\|/g, "-"));

      out.push(
        `Course: ${course}\nModule title: ${title}\nYouTube URL: ${url}\nDuration: ${duration}\nRequired: ${req}\n\nAssignment:\nAudience: ${aud}\nConditions: ${cleanConditions}\nDue: ${due}\nRepeat: ${rep}\n`
      );

      records.push({
        course,
        moduleTitle: title,
        searchQuery: query,
        videoId: pick.id,
        videoTitle: cleanVideoTitle,
        channel: pick.snippet.channelTitle,
        url,
        durationSeconds,
        duration,
        required: req === "Yes",
        audience: aud,
        conditions: cleanConditions,
        due,
        repeat: rep,
        public: true,
        uploadStatus: "processed",
        embeddable: true,
        region: REGION,
      });

      table.push(
        `| ${table.length + 1} | ${course} | ${title} | ${cleanVideoTitle} (${pick.snippet.channelTitle}) | ${url} | ${duration} | Yes | Yes | Verified via API |`
      );
    } catch (error) {
      console.error(`FATAL: ${course} / ${title}: ${error.message}`);
      throw error;
    }
  }

  const report =
    "| # | Course | Module | YouTube Video Title (Channel) | YouTube URL | Duration | Public? | Embeddable? | Verification status |\n" +
    "| - | ------ | ------ | ----- | --- | -------- | ------- | ----------- | ------ |\n" +
    table.join("\n") +
    (missing.length
      ? `\n\nNOT FOUND (no public, processed, embeddable video available in region ${REGION}):\n- ${missing.join("\n- ")}\n`
      : "\n");

  atomicWrite("docs/course-video-dataset.txt", out.join("\n"));
  atomicWrite("docs/course-video-dataset.json", JSON.stringify(records, null, 2));
  atomicWrite("docs/COURSE_VIDEO_VERIFICATION.md", report);

  console.log(`Done: ${out.length}/${M.length} modules filled. Missing: ${missing.length}`);
  if (missing.length) {
    console.log(
      `Review NOT FOUND entries in docs/COURSE_VIDEO_VERIFICATION.md. No placeholder IDs were added.`
    );
  }
}

run().catch((error) => {
  console.error(
    `Video verification aborted; existing dataset outputs were not replaced. ${error.message}`
  );
  process.exitCode = 1;
});