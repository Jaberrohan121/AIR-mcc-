/**
 * Admin-managed voice assistant frontend.
 */

// ============================================================================
// 1. EMPTY ADMIN KNOWLEDGE BASE

const DEFAULT_DATA = {
  collegeData: {
    history: {
      title: "",
      category: "history",
      verified: false,
      lastUpdated: "",
      content: "",
      motto: "",
      established: "",
      foundationDate: "",
      foundationLaidBy: "",
      inaugurationDate: "",
      inauguratedBy: "",
      firstPrincipal: "",
      area: "",
      district: ""
    },
    academics: { curriculum: "", classes: "", disciplines: [], labs: [], library: "" },
    facilities: [],
    clubs: [],
    traditions: []
  },
  houseData: [],
  administrationData: [],
  cadetsData: [],
  alumniData: [],
  achievementData: [],
  eventData: [],
  sampleQuestions: [],
  pendingQueue: [],
  auditLog: []
};

// ============================================================================
// 2. STORAGE MANAGER
// ============================================================================

const STORAGE_KEY = "mcc_ai_knowledge_db_v1";

const LEGACY_DEMO_IDS = {
  houseData: ["fazlul-haque", "suhrawardy", "nazrul"],
  administrationData: ["adm-01", "adm-02", "adm-03", "adm-04", "adm-05", "adm-hist-01", "adm-hist-02"],
  cadetsData: ["cdt-2410", "cdt-2418", "cdt-2425", "cdt-2431"],
  alumniData: ["alm-4501", "alm-5001", "alm-3801", "alm-2801", "alm-1801"],
  achievementData: ["ach-01", "ach-02", "ach-03", "ach-04"],
  eventData: ["evt-01", "evt-02", "evt-03"],
  sampleQuestions: Array.from({ length: 10 }, (_, index) => `sq-${index + 1}`)
};

const StorageManager = {
  loadData() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const data = JSON.parse(stored);
        if (!data || typeof data !== "object" || Array.isArray(data)) {
          throw new Error("Stored knowledge data must be an object.");
        }

        let updated = false;
        for (const [resource, demoIds] of Object.entries(LEGACY_DEMO_IDS)) {
          if (Array.isArray(data[resource])) {
            const filtered = data[resource].filter(record => !demoIds.includes(record?.id));
            if (filtered.length !== data[resource].length) {
              data[resource] = filtered;
              updated = true;
            }
          }
        }
        if (Array.isArray(data.eventsData)) {
          const adminEvents = data.eventsData.filter(record => !LEGACY_DEMO_IDS.eventData.includes(record?.id));
          data.eventData = [...(Array.isArray(data.eventData) ? data.eventData : []), ...adminEvents];
          delete data.eventsData;
          updated = true;
        }

        const storedHistory = data.collegeData?.history;
        if (storedHistory?.lastUpdated === "2026-10-01" && storedHistory.content?.startsWith("Mirzapur Cadet College has a long and significant history")) {
          data.collegeData = JSON.parse(JSON.stringify(DEFAULT_DATA.collegeData));
          updated = true;
        }

        const normalized = {
          ...DEFAULT_DATA,
          ...data,
          collegeData: {
            ...DEFAULT_DATA.collegeData,
            ...(data.collegeData || {}),
            history: { ...DEFAULT_DATA.collegeData.history, ...(data.collegeData?.history || {}) },
            academics: { ...DEFAULT_DATA.collegeData.academics, ...(data.collegeData?.academics || {}) }
          }
        };
        for (const resource of ["houseData", "administrationData", "cadetsData", "alumniData", "achievementData", "eventData", "sampleQuestions", "pendingQueue", "auditLog"]) {
          if (!Array.isArray(normalized[resource])) normalized[resource] = [];
        }
        if (updated) this.saveData(normalized);
        return normalized;
      }
    } catch (error) {
      console.error("Storage read error; initializing an empty admin knowledge base:", error);
    }

    const emptyData = JSON.parse(JSON.stringify(DEFAULT_DATA));
    this.saveData(emptyData);
    return emptyData;
  },

  saveData(data) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (error) {
      console.error("Storage write error:", error);
    }
  },

  resetDefaults() {
    const emptyData = JSON.parse(JSON.stringify(DEFAULT_DATA));
    this.saveData(emptyData);
    return emptyData;
  }
};

// Active state reference
let DB = StorageManager.loadData();

function formatClassNumber(value) {
  const romanToArabic = { VII: "7", VIII: "8", IX: "9", X: "10", XI: "11", XII: "12" };
  const classValue = String(value || "").trim();
  const match = classValue.match(/^(?:class|grade)\s*(VII|VIII|IX|XII|XI|X|7|8|9|10|11|12)$/i)
    || classValue.match(/^(VII|VIII|IX|XII|XI|X|7|8|9|10|11|12)$/i);
  if (!match) return classValue;
  const valueToken = match[1].toUpperCase();
  return `Class ${romanToArabic[valueToken] || valueToken}`;
}

const conversationContext = {
  language: "en"
};

function normalizeSampleQuestionText(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeVoiceTranscript(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/\b(?:um|uh|ah|erm|like)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseKeywords(value) {
  if (Array.isArray(value)) {
    return value
      .map(part => String(part).trim())
      .filter(Boolean);
  }
  return String(value || "")
    .split(",")
    .map(part => part.trim())
    .filter(Boolean);
}

function getNormalizedQuestionVariants(item) {
  const variations = Array.isArray(item?.variations) ? item.variations : [];
  const keywords = parseKeywords(item?.keywords);
  return [item?.question, ...variations, ...keywords]
    .filter(value => typeof value === "string" && value.trim())
    .map(normalizeSampleQuestionText)
    .filter(Boolean);
}

function cleanSpeechText(text) {
  if (!text) return "";
  return String(text)
    .split(/\r?\n/)
    .filter(line => !/^\s*(?:keywords?|match keywords?|source|last updated|updated)\s*:/i.test(line))
    .map(line => line.replace(/([.!?])\s+(?:keywords?|match keywords?)\s*:\s*.*$/i, "$1").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

const INTERNAL_RECORD_FIELDS = new Set([
  "id", "photo", "privacy", "status", "verified", "lastupdated", "recordtype", "keyword", "keywords"
]);

function getAnswerableWords(value) {
  const ignoredWords = new Set([
    "a", "about", "an", "and", "are", "as", "at", "be", "can", "college", "did",
    "do", "does", "for", "from", "give", "he", "her", "him", "his", "i", "in",
    "is", "it", "me", "mcc", "of", "on", "please", "she", "tell", "that", "the",
    "their", "them", "there", "this", "to", "was", "what", "when", "where", "which",
    "who", "why", "with", "you"
  ]);
  return normalizeSampleQuestionText(value)
    .split(" ")
    .filter(word => word.length > 1 && !ignoredWords.has(word));
}

function getNameTokenSimilarity(first, second) {
  if (first === second) return 1;
  if (first.length < 4 || second.length < 4) return 0;

  const previousRow = Array.from({ length: second.length + 1 }, (_, index) => index);
  for (let firstIndex = 1; firstIndex <= first.length; firstIndex += 1) {
    let diagonal = previousRow[0];
    previousRow[0] = firstIndex;
    for (let secondIndex = 1; secondIndex <= second.length; secondIndex += 1) {
      const previous = previousRow[secondIndex];
      previousRow[secondIndex] = Math.min(
        previousRow[secondIndex] + 1,
        previousRow[secondIndex - 1] + 1,
        diagonal + (first[firstIndex - 1] === second[secondIndex - 1] ? 0 : 1)
      );
      diagonal = previous;
    }
  }
  return 1 - previousRow[second.length] / Math.max(first.length, second.length);
}

function getPersonNameMatch(personName, text) {
  const nameTokens = normalizeSampleQuestionText(personName).split(" ").filter(Boolean);
  const queryTokens = normalizeSampleQuestionText(text).split(" ").filter(Boolean);
  const usedQueryTokens = new Set();
  let matchedTokens = 0;
  let totalSimilarity = 0;

  for (const nameToken of nameTokens) {
    let bestIndex = -1;
    let bestSimilarity = 0;
    for (let index = 0; index < queryTokens.length; index += 1) {
      if (usedQueryTokens.has(index)) continue;
      const similarity = getNameTokenSimilarity(nameToken, queryTokens[index]);
      if (similarity > bestSimilarity) {
        bestIndex = index;
        bestSimilarity = similarity;
      }
    }
    if (bestIndex >= 0 && (bestSimilarity === 1 || bestSimilarity >= 0.75)) {
      usedQueryTokens.add(bestIndex);
      matchedTokens += 1;
      totalSimilarity += bestSimilarity;
    }
  }

  return {
    matchedTokens,
    coverage: nameTokens.length ? matchedTokens / nameTokens.length : 0,
    similarity: matchedTokens ? totalSimilarity / matchedTokens : 0
  };
}

function scoreCadetNameInTranscript(text) {
  const cadets = Array.isArray(DB.cadetsData) ? DB.cadetsData : [];
  return cadets.reduce((bestScore, cadet) => {
    const match = getPersonNameMatch(cadet?.name || "", text);
    const isStrongMatch = match.coverage === 1 && match.matchedTokens > 0 &&
      (match.matchedTokens > 1 || normalizeSampleQuestionText(cadet.name).length >= 5);
    return isStrongMatch ? Math.max(bestScore, match.matchedTokens * 10 + match.similarity) : bestScore;
  }, 0);
}

function selectSpeechAlternative(result) {
  let selected = result[0] || { transcript: "" };
  let selectedNameScore = scoreCadetNameInTranscript(selected.transcript || "");

  for (let index = 1; index < result.length; index += 1) {
    const candidate = result[index];
    const candidateNameScore = scoreCadetNameInTranscript(candidate.transcript || "");
    const candidateConfidence = typeof candidate.confidence === "number" ? candidate.confidence : 0;
    const selectedConfidence = typeof selected.confidence === "number" ? selected.confidence : 0;
    if (candidateNameScore > selectedNameScore ||
        (candidateNameScore === selectedNameScore && candidateConfidence > selectedConfidence)) {
      selected = candidate;
      selectedNameScore = candidateNameScore;
    }
  }
  return selected;
}

function formatPersonRecordFieldValue(value) {
  if (value === null || value === undefined || value === "") return "";
  if (Array.isArray(value)) {
    return value.map(formatPersonRecordFieldValue).filter(Boolean).join(", ");
  }
  if (typeof value === "object") {
    return Object.entries(value)
      .filter(([key]) => !INTERNAL_RECORD_FIELDS.has(key.toLowerCase()))
      .map(([key, item]) => {
        const formatted = formatPersonRecordFieldValue(item);
        return formatted ? `${key.replace(/([A-Z])/g, " $1").toLowerCase()} ${formatted}` : "";
      })
      .filter(Boolean)
      .join(", ");
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value).trim();
}

function formatPersonRecordSentence(key, value) {
  const formatted = formatPersonRecordFieldValue(value);
  if (!formatted) return "";
  const sentences = {
    name: formatted,
    biography: formatted,
    desc: formatted,
    cadetNumber: `Cadet number ${formatted}`,
    batch: `Batch ${formatted}`,
    house: `${formatted} House`,
    className: formatClassNumber(formatted),
    role: `Role: ${formatted}`,
    profession: `Profession: ${formatted}`,
    position: `Position: ${formatted}`,
    department: `Department: ${formatted}`,
    organization: `Organization: ${formatted}`,
    graduationYear: `Graduated in ${formatted}`,
    achievements: `Achievements include ${formatted}`,
    activities: `Activities include ${formatted}`,
    publications: `Publications include ${formatted}`,
    education: `Education includes ${formatted}`,
    section: `Section ${formatted}`,
    officialContact: `Official contact: ${formatted}`
  };
  if (sentences[key]) return sentences[key];
  const label = key.replace(/([A-Z])/g, " $1").toLowerCase();
  return `${label}: ${formatted}`;
}

function getPersonAchievements(person) {
  const personAchievements = (Array.isArray(person.achievements) ? person.achievements : [])
    .map(formatPersonRecordFieldValue)
    .filter(Boolean);
  const normalizedName = normalizeSampleQuestionText(person.name);
  const relatedAchievements = (Array.isArray(DB.achievementData) ? DB.achievementData : [])
    .filter(record => record && normalizedName &&
      normalizeSampleQuestionText(record.recipient) === normalizedName)
    .map(record => [record.title, record.year, record.desc]
      .map(formatPersonRecordFieldValue)
      .filter(Boolean)
      .join(" "));
  return [...new Set([...personAchievements, ...relatedAchievements].filter(Boolean))];
}

function buildPersonRecordAnswer(queryText) {
  const q = normalizeSampleQuestionText(queryText);
  if (!q) return null;

  const sourceRecords = [
    ...DB.administrationData.filter(person => person && typeof person === "object").map(person => ({ ...person, recordType: "administration" })),
    ...DB.cadetsData.filter(person => person && typeof person === "object").map(person => ({ ...person, recordType: "cadet" })),
    ...DB.alumniData.filter(person => person && typeof person === "object" && person.privacy === "PUBLIC").map(person => ({ ...person, recordType: "alumni" }))
  ];
  const personRecordsByIdentity = new Map();
  for (const person of sourceRecords) {
    const name = normalizeSampleQuestionText(person.name || "");
    const number = normalizeSampleQuestionText(person.cadetNumber || "");
    const identity = name ? `${name}|${number}` : `${person.recordType}|${person.id}`;
    const existing = personRecordsByIdentity.get(identity);
    if (existing) {
      personRecordsByIdentity.set(identity, {
        ...existing,
        ...person,
        achievements: [
          ...(Array.isArray(existing.achievements) ? existing.achievements : []),
          ...(Array.isArray(person.achievements) ? person.achievements : [])
        ]
      });
    } else {
      personRecordsByIdentity.set(identity, person);
    }
  }
  const personRecords = [...personRecordsByIdentity.values()];

  const qWords = new Set(getAnswerableWords(q));
  const asksForPersonByRole = /\b(who|which|name|tell me about|about|principal|vice principal|adjutant|teacher|faculty|staff|headmaster|founder|প্রিন্সিপাল|অধ্যক্ষ|উপাধ্যক্ষ)\b/.test(q);
  const classMatch = q.match(/\b(?:class|ক্লাস)\s*(7|8|9|10|11|12)\b/);
  const normalizedClassTarget = classMatch ? `class ${classMatch[1]}` : "";
  const scoredEntries = personRecords.map(person => {
    const cleanedName = normalizeSampleQuestionText(person.name || "");
    const roleText = normalizeSampleQuestionText(person.position || person.role || person.profession || "");
    const classText = normalizeSampleQuestionText(person.className || "");
    let score = 0;

    if (cleanedName) {
      if (q === cleanedName || q.includes(cleanedName)) score += 1000;
      const nameTokens = new Set(getAnswerableWords(cleanedName));
      const exactNameTokenMatches = [...nameTokens].filter(token => qWords.has(token)).length;
      const fuzzyNameMatch = getPersonNameMatch(cleanedName, q);
      const matchingNameTokens = Math.max(exactNameTokenMatches, fuzzyNameMatch.matchedTokens);
      if (matchingNameTokens) {
        const minimumNameLength = normalizeSampleQuestionText(cleanedName).length;
        const isSpecificFuzzyMatch = fuzzyNameMatch.coverage === 1 &&
          (fuzzyNameMatch.matchedTokens > 1 || minimumNameLength >= 5);
        if (exactNameTokenMatches || isSpecificFuzzyMatch) {
          score = Math.max(score, 100 + matchingNameTokens * 30 + fuzzyNameMatch.similarity);
        }
      }
    }

    const cadetNumber = normalizeSampleQuestionText(person.cadetNumber || "");
    if (cadetNumber && q.includes(cadetNumber)) score = Math.max(score, 1000);
    if (classText && normalizedClassTarget && (classText.includes(normalizedClassTarget) || q.includes(classText) || q.includes(normalizedClassTarget))) {
      score = Math.max(score, 1100);
    } else if (classText && q.includes(classText)) {
      score = Math.max(score, 900);
    }

    if (asksForPersonByRole) {
      if (roleText && q.includes(roleText)) {
        score = Math.max(score, 80 + roleText.length);
      }
      for (const keyword of Array.isArray(person.keywords) ? person.keywords : []) {
        const normalizedKeyword = normalizeSampleQuestionText(keyword);
        if (normalizedKeyword && q.includes(normalizedKeyword)) {
          score = Math.max(score, 70);
        }
      }
    }

    return { person, score };
  }).filter(entry => entry.score > 0);

  if (!scoredEntries.length) return null;
  scoredEntries.sort((a, b) => b.score - a.score);
  if (scoredEntries.length > 1 && scoredEntries[0].score === scoredEntries[1].score) return null;
  if (scoredEntries[0].score < 70) return null;

  const matched = scoredEntries[0].person;
  const asks = pattern => pattern.test(q);
  let requestedFields;
  if (asks(/\b(batch|batch number|graduation batch)\b/) || /ব্যাচ/.test(q)) {
    requestedFields = [["batch", matched.batch]];
  } else if (asks(/\b(cadet number|cadet no|c no|cno|number|id)\b/) || /ক্যাডেট নম্বর|ক্যাডেট নং/.test(q)) {
    requestedFields = [["cadetNumber", matched.cadetNumber]];
  } else if (asks(/\b(house|house affiliation)\b/) || /হাউস/.test(q)) {
    requestedFields = [["house", matched.house]];
  } else if (asks(/\b(class|grade|year group)\b/) || /শ্রেণি|ক্লাস/.test(q)) {
    requestedFields = [["className", matched.className]];
  } else if (asks(/\b(role|position|title|profession|job|work as|what does .* do)\b/) || /পদ|পেশা/.test(q)) {
    requestedFields = [["role", matched.position || matched.role || matched.profession]];
  } else if (asks(/\b(organization|organisation|department|workplace|where does .* work)\b/)) {
    requestedFields = [["organization", matched.organization || matched.department]];
  } else if (asks(/\b(graduat(?:e|ed|ion)|graduation year|pass(?:ed)? out|left college)\b/)) {
    requestedFields = [["graduationYear", matched.graduationYear]];
  } else if (asks(/\b(achievement|award|honou?r|medal)\b/) || /অর্জন|পুরস্কার/.test(q)) {
    const achievements = getPersonAchievements(matched);
    requestedFields = [["achievements", achievements.length ? achievements.join(". ") : ""]];
  } else if (asks(/\b(education|degree|study|studied|qualification)\b/)) {
    requestedFields = [["education", matched.education]];
  } else if (asks(/\b(contact|phone|email)\b/)) {
    requestedFields = [["officialContact", matched.officialContact]];
  } else if (asks(/\b(biography|background|history|tell me about|about)\b/) || /সম্পর্কে|পরিচয়/.test(q)) {
    requestedFields = [
      ["name", matched.name],
      ["role", matched.position || matched.role || matched.profession],
      ["organization", matched.organization || matched.department],
      ["batch", matched.batch],
      ["house", matched.house],
      ["className", matched.className],
      ["biography", matched.biography],
      ["achievements", getPersonAchievements(matched).join(". ")]
    ];
  } else {
    requestedFields = [["name", matched.name], ["role", matched.position || matched.role || matched.profession]];
  }

  const details = requestedFields
    .map(([key, value]) => formatPersonRecordSentence(key, value))
    .filter(Boolean)
    .map(detail => detail.replace(/[.!?]+$/u, ""));
  if (!details.length) {
    return {
      person: matched,
      text: `Sorry, I couldn't find that information for ${matched.name}.`,
      verified: false,
      source: "Institutional record",
      lastUpdated: "Institutional record",
      notFound: true
    };
  }

  return {
    person: matched,
    text: `${details.join(". ")}.`,
    verified: true,
    source: "Institutional record",
    lastUpdated: "Institutional record"
  };
}

function findSampleQuestionAnswer(queryText) {
  const normalizedQuery = normalizeSampleQuestionText(queryText);
  if (!normalizedQuery) return null;

  const sampleQuestions = (Array.isArray(DB.sampleQuestions) ? DB.sampleQuestions : []).filter(item =>
    item && typeof item.question === "string" && item.question.trim() &&
    typeof item.answer === "string" && item.answer.trim()
  );

  const exactMatch = sampleQuestions.find(item => {
    const normalizedVariants = getNormalizedQuestionVariants(item);
    return normalizedVariants.some(variant =>
      variant === normalizedQuery ||
      variant.includes(normalizedQuery) ||
      normalizedQuery.includes(variant)
    );
  });
  if (exactMatch) return exactMatch;

  const queryWords = new Set(getAnswerableWords(normalizedQuery));
  const matches = sampleQuestions.map(item => {
    const variants = getNormalizedQuestionVariants(item);
    const questionWords = new Set(variants.flatMap(getAnswerableWords));
    const keywordWords = new Set(parseKeywords(item?.keywords).flatMap(getAnswerableWords));
    const keywordOverlap = [...queryWords].filter(word => keywordWords.has(word)).length;
    const questionOverlap = [...queryWords].filter(word => questionWords.has(word)).length;
    const meaningfulQuerySize = queryWords.size;
    const coverage = meaningfulQuerySize ? questionOverlap / meaningfulQuerySize : 0;
    const exactKeywordPhrase = parseKeywords(item?.keywords).some(keyword => {
      const normalizedKeyword = normalizeSampleQuestionText(keyword);
      return normalizedKeyword && (normalizedQuery.includes(normalizedKeyword) || normalizedKeyword.includes(normalizedQuery));
    });
    const phraseBoost = variants.some(variant =>
      variant === normalizedQuery ||
      variant.includes(normalizedQuery) ||
      normalizedQuery.includes(variant)
    ) ? 12 : 0;
    const score = questionOverlap * 4 + keywordOverlap * 2 + phraseBoost;

    if (meaningfulQuerySize < 1 || (questionOverlap < 1 && keywordOverlap < 1)) return null;
    if (!exactKeywordPhrase && questionOverlap < 2 &&
        !(meaningfulQuerySize === 1 && questionOverlap === 1)) return null;
    if (!exactKeywordPhrase && meaningfulQuerySize > 2 && coverage < 0.5) return null;
    return { item, score, coverage, exactKeywordPhrase };
  }).filter(Boolean);

  if (!matches.length) return null;
  matches.sort((a, b) =>
    Number(b.exactKeywordPhrase) - Number(a.exactKeywordPhrase) ||
    b.score - a.score ||
    b.coverage - a.coverage
  );
  if (matches.length > 1 &&
      matches[0].exactKeywordPhrase === matches[1].exactKeywordPhrase &&
      matches[0].score === matches[1].score &&
      matches[0].coverage === matches[1].coverage) return null;
  return matches[0].item;
}

async function generateAnswer(queryText) {
  const normalizedQuery = normalizeSampleQuestionText(queryText);
  const sampleAnswer = findSampleQuestionAnswer(queryText);
  if (sampleAnswer) {
    return {
      text: sampleAnswer.answer,
      classification: { category: "SAMPLE QUESTION", intent: "SAVED_SAMPLE_QUESTION", name: null, batch: null, house: null },
      verified: true,
      source: "Saved sample question",
      lastUpdated: "Knowledge base"
    };
  }

  const personAnswer = buildPersonRecordAnswer(queryText);
  if (personAnswer) {
    return {
      text: personAnswer.text,
      person: personAnswer.person,
      classification: { category: "PERSON RECORD", intent: "PERSON_QUERY", name: null, batch: null, house: null },
      verified: personAnswer.verified,
      source: personAnswer.source,
      lastUpdated: personAnswer.lastUpdated,
      notFound: personAnswer.notFound === true
    };
  }

  if (!normalizedQuery || normalizedQuery.length < 3) {
    return {
      text: "Sorry, I couldn’t understand that question.",
      classification: { category: "UNKNOWN", intent: "UNRECOGNIZED_QUERY", name: null, batch: null, house: null },
      verified: false,
      source: "Voice input",
      lastUpdated: "Not recognized",
      notFound: true
    };
  }

  const knowledge = {
    collegeData: DB.collegeData,
    houseData: DB.houseData,
    administrationData: DB.administrationData,
    cadetsData: DB.cadetsData,
    alumniData: DB.alumniData.filter(person => person.privacy === "PUBLIC"),
    achievementData: DB.achievementData,
    eventData: DB.eventData,
    sampleQuestions: DB.sampleQuestions
  };
  const adminInfo = JSON.stringify(knowledge, (key, value) =>
    INTERNAL_RECORD_FIELDS.has(key.toLowerCase()) ? undefined : value
  );
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 90000);
  let response;
  try {
    response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: queryText,
      language: SpeechEngine.lang,
      systemInstruction: `First identify what the user is asking and which person, sample question, or other subject they mean. Answer only the specific question using the administrator-provided knowledge below. Do not invent, assume, or combine facts from different records. For a person, answer only the requested detail; do not expose keywords or matching metadata. If the question or subject is unclear, or the requested fact is absent, reply exactly: "Sorry, I couldn't understand that question or find the requested information." Never include record status, verification state, internal IDs, privacy settings, or last-updated dates.\n\nAdministrator-provided knowledge:\n${adminInfo}`
    }),
    signal: controller.signal
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("The AI took too long to respond. Please try your question again.");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `AI request failed (${response.status})`);
  }
  if (!data || typeof data.text !== "string" || !data.text.trim()) {
    return {
      text: "Sorry, I couldn’t understand that question.",
      classification: { category: "UNKNOWN", intent: "UNRECOGNIZED_QUERY", name: null, batch: null, house: null },
      verified: false,
      source: "Voice input",
      lastUpdated: "Not recognized",
      notFound: true
    };
  }

  return {
    text: data.text.trim(),
    classification: { category: "ADMIN DATA", intent: "ADMIN_KNOWLEDGE_QUERY", name: null, batch: null, house: null },
    verified: false,
    source: data.source || "Admin-provided information",
    lastUpdated: "Real-time"
  };
}

// ============================================================================
// 5. REAL-TIME CANVAS AUDIO VISUALIZER & SPEECH ENGINE
// ============================================================================

const AudioVisualizer = {
  canvas: null,
  ctx: null,
  audioCtx: null,
  analyser: null,
  source: null,
  micStream: null,
  dataArray: null,
  animationId: null,
  isActive: false,
  mode: "idle", // 'idle' | 'listening' | 'speaking'
  smoothedVolume: 0,
  cssWidth: 600,
  cssHeight: 80,
  particles: [],

  init() {
    this.canvas = document.getElementById("audioVisualizerCanvas");
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext("2d");
    this.resize();
    window.addEventListener("resize", () => this.resize());

    // Generate floating institutional gold dust particles
    this.particles = Array.from({ length: 32 }, () => ({
      x: Math.random() * this.cssWidth,
      y: Math.random() * this.cssHeight,
      radius: Math.random() * 1.6 + 0.6,
      vx: (Math.random() - 0.5) * 0.4,
      vy: (Math.random() - 0.5) * 0.3,
      alpha: Math.random() * 0.5 + 0.2
    }));

    this.startLoop();
  },

  resize() {
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.cssWidth = rect.width || 600;
    this.cssHeight = rect.height || 80;
    this.canvas.width = this.cssWidth * dpr;
    this.canvas.height = this.cssHeight * dpr;
    if (this.ctx) {
      this.ctx.resetTransform?.();
      this.ctx.scale(dpr, dpr);
    }
  },

  async startMic() {
    this.mode = "listening";
    this.isActive = true;

    try {
      const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
      if (!this.audioCtx && AudioCtxClass) {
        this.audioCtx = new AudioCtxClass();
      }
      if (this.audioCtx && this.audioCtx.state === "suspended") {
        await this.audioCtx.resume();
      }

      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        this.micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
        });

        if (this.audioCtx) {
          this.analyser = this.audioCtx.createAnalyser();
          this.analyser.fftSize = 128;
          this.analyser.smoothingTimeConstant = 0.75;

          this.source = this.audioCtx.createMediaStreamSource(this.micStream);
          this.source.connect(this.analyser);

          const bufferLength = this.analyser.frequencyBinCount;
          this.dataArray = new Uint8Array(bufferLength);
        }
      }

      const statusEl = document.getElementById("audioStatusVal");
      if (statusEl) statusEl.textContent = "Live Mic Active";
    } catch (err) {
      console.warn("Real-time mic stream permission or hardware notice:", err);
      // Fallback: visualizer continues in simulated reactive mode
      const statusEl = document.getElementById("audioStatusVal");
      if (statusEl) statusEl.textContent = "Listening (Simulated)";
    }
  },

  stopMic() {
    this.mode = "idle";
    this.isActive = false;

    if (this.micStream) {
      this.micStream.getTracks().forEach(track => track.stop());
      this.micStream = null;
    }
    if (this.source) {
      try { this.source.disconnect(); } catch (e) {}
      this.source = null;
    }

    const volEl = document.getElementById("audioVolumeVal");
    const statusEl = document.getElementById("audioStatusVal");
    if (volEl) volEl.textContent = "0 dB";
    if (statusEl) statusEl.textContent = "Standby";
  },

  setSpeaking(isSpeaking) {
    this.mode = isSpeaking ? "speaking" : "idle";
    const statusEl = document.getElementById("audioStatusVal");
    if (statusEl) {
      statusEl.textContent = isSpeaking ? "Voice Synthesizer Active" : "Standby";
    }
  },

  startLoop() {
    const render = () => {
      this.draw();
      this.animationId = requestAnimationFrame(render);
    };
    render();
  },

  draw() {
    if (!this.ctx || !this.canvas) return;
    const ctx = this.ctx;
    const w = this.cssWidth || 600;
    const h = this.cssHeight || 80;
    const cy = h / 2;

    ctx.clearRect(0, 0, w, h);

    // Compute real volume level if listening
    let volumeRatio = 0;
    if (this.mode === "listening" && this.analyser && this.dataArray) {
      this.analyser.getByteFrequencyData(this.dataArray);
      let sum = 0;
      for (let i = 0; i < this.dataArray.length; i++) {
        sum += this.dataArray[i];
      }
      const avg = sum / this.dataArray.length;
      volumeRatio = Math.min(1, avg / 120);
      this.smoothedVolume = this.smoothedVolume * 0.7 + volumeRatio * 0.3;

      const volEl = document.getElementById("audioVolumeVal");
      if (volEl) {
        const dB = Math.round(this.smoothedVolume * 65);
        volEl.textContent = `${dB} dB`;
      }
    } else if (this.mode === "listening") {
      // Fallback simulated listening waveform when mic hardware direct stream is unavailable
      const t = performance.now() * 0.005;
      volumeRatio = 0.3 + Math.sin(t * 3) * 0.2 + Math.cos(t * 5) * 0.15;
      this.smoothedVolume = this.smoothedVolume * 0.75 + volumeRatio * 0.25;
      const volEl = document.getElementById("audioVolumeVal");
      if (volEl) volEl.textContent = `${Math.round(this.smoothedVolume * 55)} dB`;
    } else if (this.mode === "speaking") {
      const t = performance.now() * 0.006;
      volumeRatio = 0.4 + Math.sin(t * 4) * 0.3 + Math.cos(t * 8) * 0.15;
      this.smoothedVolume = this.smoothedVolume * 0.7 + volumeRatio * 0.3;
      const volEl = document.getElementById("audioVolumeVal");
      if (volEl) volEl.textContent = `${Math.round(this.smoothedVolume * 50)} dB`;
    } else {
      this.smoothedVolume = this.smoothedVolume * 0.85;
      volumeRatio = 0;
    }

    // Render floating background dust particles
    ctx.save();
    for (const p of this.particles) {
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < 0) p.x = w;
      if (p.x > w) p.x = 0;
      if (p.y < 0) p.y = h;
      if (p.y > h) p.y = 0;

      ctx.fillStyle = `rgba(212, 175, 55, ${p.alpha * (0.35 + this.smoothedVolume * 0.65)})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius * (1 + this.smoothedVolume * 0.8), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Baseline axis rule
    ctx.save();
    const baseGradient = ctx.createLinearGradient(0, cy, w, cy);
    baseGradient.addColorStop(0, "rgba(16, 185, 129, 0.05)");
    baseGradient.addColorStop(0.5, `rgba(212, 175, 55, ${0.2 + this.smoothedVolume * 0.5})`);
    baseGradient.addColorStop(1, "rgba(16, 185, 129, 0.05)");
    ctx.strokeStyle = baseGradient;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, cy);
    ctx.lineTo(w, cy);
    ctx.stroke();
    ctx.restore();

    // Frequency Spectrum / Equalizer Bars (48 symmetric bars)
    const barCount = 44;
    const barWidth = Math.max(3, (w / barCount) - 3.5);
    const time = performance.now() * 0.003;

    for (let i = 0; i < barCount; i++) {
      const x = i * (w / barCount) + (w / barCount - barWidth) / 2;
      const centerDist = Math.abs(i - barCount / 2) / (barCount / 2);
      const bellCurve = Math.cos(centerDist * Math.PI * 0.46);

      let barHeight = 4;

      if (this.mode === "listening" && this.dataArray) {
        const binIndex = Math.floor((1 - centerDist) * (this.dataArray.length - 1));
        const freqVal = this.dataArray[binIndex] || 0;
        const normalized = freqVal / 255;
        barHeight = Math.max(4, normalized * (h * 0.88) * bellCurve);
      } else if (this.mode === "listening") {
        const wave = Math.sin(time * 5 + i * 0.45) * 0.5 + 0.5;
        barHeight = Math.max(4, (wave * 0.65 + 0.35) * (h * 0.75) * bellCurve);
      } else if (this.mode === "speaking") {
        const wave = Math.sin(time * 6 + i * 0.35) * Math.cos(time * 3.5 - i * 0.2);
        barHeight = Math.max(4, Math.abs(wave) * (h * 0.72) * bellCurve);
      } else {
        // Idle gentle breathing wave
        const idleWave = Math.sin(time * 1.5 + i * 0.25) * 0.5 + 0.5;
        barHeight = 4 + idleWave * 8 * bellCurve;
      }

      // Bar gradient: Emerald into Gold
      const grad = ctx.createLinearGradient(x, cy - barHeight / 2, x, cy + barHeight / 2);
      if (this.mode === "listening") {
        grad.addColorStop(0, "#34d399"); // bright emerald
        grad.addColorStop(0.5, "#d4af37"); // gold
        grad.addColorStop(1, "#10b981");
      } else if (this.mode === "speaking") {
        grad.addColorStop(0, "#38bdf8"); // bright cyan-blue
        grad.addColorStop(0.5, "#818cf8");
        grad.addColorStop(1, "#3b82f6");
      } else {
        grad.addColorStop(0, "rgba(197, 160, 89, 0.55)");
        grad.addColorStop(0.5, "rgba(212, 175, 55, 0.85)");
        grad.addColorStop(1, "rgba(15, 56, 42, 0.6)");
      }

      ctx.fillStyle = grad;
      ctx.beginPath();
      const top = cy - barHeight / 2;
      const radius = Math.min(barWidth / 2, barHeight / 2);
      if (ctx.roundRect) {
        ctx.roundRect(x, top, barWidth, barHeight, radius);
      } else {
        ctx.rect(x, top, barWidth, barHeight);
      }
      ctx.fill();
    }

    // Dynamic Central Waveform Contour Ribbon
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(0, cy);
    for (let x = 0; x < w; x += 4) {
      let offset = 0;
      if (this.mode === "listening") {
        offset = Math.sin(x * 0.05 - time * 8) * (14 * this.smoothedVolume + 2) +
                 Math.sin(x * 0.02 + time * 4) * (8 * this.smoothedVolume);
      } else if (this.mode === "speaking") {
        offset = Math.sin(x * 0.04 - time * 6) * 12 * this.smoothedVolume;
      } else {
        offset = Math.sin(x * 0.02 - time * 2) * 3;
      }
      ctx.lineTo(x, cy + offset);
    }
    ctx.strokeStyle = this.mode === "listening" ? "rgba(52, 211, 153, 0.9)" :
                      this.mode === "speaking" ? "rgba(56, 189, 248, 0.9)" :
                      "rgba(212, 175, 55, 0.45)";
    ctx.lineWidth = 2;
    ctx.shadowColor = this.mode === "listening" ? "#10b981" : "#d4af37";
    ctx.shadowBlur = this.smoothedVolume > 0.1 ? 12 : 4;
    ctx.stroke();
    ctx.restore();
  }
};

const SpeechEngine = {
  recognition: null,
  isListening: false,
  isStarting: false,
  isSpeaking: false,
  selectedVoice: null,
  speechRate: 1.0,
  lang: "en-US",
  audioElement: null,
  audioObjectUrl: null,
  audioRequestController: null,
  speechGeneration: 0,
  fallbackNoticeShown: false,
  pendingTranscript: "",
  lastTranscript: "",
  captureCallback: null,
  transcriptTimer: null,

  init() {
    this.createRecognition();

    // Preload SpeechSynthesis voices
    if ("speechSynthesis" in window) {
      window.speechSynthesis.onvoiceschanged = () => {
        this.loadVoices();
      };
      this.loadVoices();
    }
  },

  createRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      try {
        this.recognition = new SpeechRecognition();
        this.recognition.continuous = RobotController.handsFreeMode;
        this.recognition.interimResults = true;
        this.recognition.maxAlternatives = 5;
        this.recognition.lang = this.lang;

        this.recognition.onstart = () => {
          this.isStarting = false;
          this.isListening = true;
          this.pendingTranscript = "";
          this.lastTranscript = "";
          this.updateVisualizerState("LISTENING");
          RobotController.setState("LISTENING");
          AudioVisualizer.startMic();
          const robotTrans = document.getElementById("robotUserTranscript");
          if (robotTrans) {
            robotTrans.textContent = this.lang.startsWith("bn") ? "শুনছি... আপনার প্রশ্ন বলুন..." : "Listening... Speak your question now...";
          }
        };

        this.recognition.onresult = (event) => {
          let interimTranscript = "";
          let finalTranscript = "";

          for (let i = 0; i < event.results.length; ++i) {
            const result = event.results[i];
            const alternative = selectSpeechAlternative(result);
            const trans = normalizeVoiceTranscript(alternative.transcript || "");
            if (event.results[i].isFinal) {
              finalTranscript += `${trans} `;
            } else {
              interimTranscript += `${trans} `;
            }
          }
          finalTranscript = normalizeVoiceTranscript(finalTranscript);
          interimTranscript = normalizeVoiceTranscript(interimTranscript);
          const currentText = [finalTranscript, interimTranscript].filter(Boolean).join(" ").trim();
          if (currentText) {
            const robotTrans = document.getElementById("robotUserTranscript");
            if (robotTrans) robotTrans.textContent = `"${currentText}"`;
          }

          if (finalTranscript) {
            this.pendingTranscript = finalTranscript;
            clearTimeout(this.transcriptTimer);
            this.transcriptTimer = setTimeout(() => this.submitRecognizedTranscript(), 1200);
          }
        };

        this.recognition.onerror = (e) => {
          console.warn("Speech recognition notice:", e.error);
          this.isStarting = false;
          this.captureCallback = null;
          this.pendingTranscript = "";
          this.lastTranscript = "";
          clearTimeout(this.transcriptTimer);
          this.transcriptTimer = null;
          this.stopListening();
          const robotTrans = document.getElementById("robotUserTranscript");
          if (e.error === "no-speech") {
            if (robotTrans) robotTrans.textContent = this.lang.startsWith("bn") ? "কোনো কথা শোনা যায়নি। মাইক্রোফোনে আবার চাপুন।" : "No speech detected. Tap microphone or select a prompt.";
          } else if (e.error === "not-allowed" || e.error === "service-not-allowed") {
            if (robotTrans) robotTrans.textContent = this.lang.startsWith("bn") ? "মাইক্রোফোন অনুমতি দেওয়া হয়নি বা ব্লক রয়েছে।" : "Microphone blocked. Please allow mic or select a voice prompt.";
            RobotController.disableHandsFree();
          } else if (e.error === "audio-capture") {
            if (robotTrans) robotTrans.textContent = this.lang.startsWith("bn") ? "মাইক্রোফোন পাওয়া যায়নি। সংযোগ পরীক্ষা করে আবার চেষ্টা করুন।" : "No microphone was found. Check its connection and try again.";
          } else if (e.error === "language-not-supported") {
            if (robotTrans) robotTrans.textContent = this.lang.startsWith("bn") ? "নির্বাচিত ভাষাটি স্পিচ রিকগনিশনে সমর্থিত নয়।" : "Speech recognition does not support the selected language.";
          } else {
            if (robotTrans) robotTrans.textContent = this.lang.startsWith("bn") ? "স্পিচ রিকগনিশন ব্যর্থ হয়েছে। সংযোগ পরীক্ষা করে আবার চেষ্টা করুন।" : "Speech recognition failed. Check your connection and try again.";
          }
        };

        this.recognition.onend = () => {
          this.isStarting = false;
          this.isListening = false;
          this.updateVisualizerState("IDLE");
          AudioVisualizer.stopMic();
          if (!this.isSpeaking) RobotController.setState("IDLE");
          if (this.pendingTranscript) {
            this.submitRecognizedTranscript();
            return;
          }
          const robotTrans = document.getElementById("robotUserTranscript");
          if (robotTrans && !this.captureCallback && !RobotController.isAnswering) {
            robotTrans.textContent = this.lang.startsWith("bn")
              ? "প্রশ্নটি স্পষ্টভাবে শোনা যায়নি। আবার বলুন।"
              : "I couldn't clearly hear the question. Please try again.";
          }
          this.stopListening();
          RobotController.resumeHandsFreeListening();
        };
      } catch (err) {
        console.warn("SpeechRecognition init error:", err);
      }
    }
  },

  loadVoices() {
    if (!("speechSynthesis" in window)) return;
    const voices = window.speechSynthesis.getVoices();
    if (!voices || !voices.length) return;

    const language = this.lang.slice(0, 2).toLowerCase();
    const languageVoices = voices.filter(v => v.lang && v.lang.slice(0, 2).toLowerCase() === language);
    const maleVoiceName = /\b(male|daniel|david|alex|fred|guy|mark|james|tom|ryan|george|aaron|christopher)\b/i;
    this.selectedVoice = languageVoices.find(v => /\bmark\b/i.test(v.name))
      || languageVoices.find(v => maleVoiceName.test(v.name))
      || languageVoices.find(v => v.lang.toLowerCase() === this.lang.toLowerCase())
      || languageVoices[0]
      || voices[0];
  },

  setLanguage(langCode) {
    this.lang = langCode === "bn" ? "bn-BD" : "en-US";
    if (this.recognition) {
      try {
        this.recognition.lang = this.lang;
      } catch (e) {}
    }
    this.loadVoices();
    conversationContext.language = this.lang;
    const ctxLangEl = document.getElementById("ctxLanguage");
    if (ctxLangEl) ctxLangEl.textContent = this.lang === "bn-BD" ? "বাংলা (bn-BD)" : "English (en-US)";
    updateUiLanguage(langCode);
  },

  startListening() {
    if (this.isListening || this.isStarting) return;
    if (this.isSpeaking) this.stopSpeaking();

    if (!this.recognition) {
      this.createRecognition();
    }

    if (!this.recognition) {
      showToast(this.lang.startsWith("bn") ? "আপনার ব্রাউজারে স্পিচ রিকগনিশন সক্রিয় নয়। নিচের ভয়েস প্রম্পটে চাপুন।" : "Speech recognition unavailable. Tap any voice prompt below.", "info");
      const robotTrans = document.getElementById("robotUserTranscript");
      if (robotTrans) robotTrans.textContent = this.lang.startsWith("bn") ? "নিচের যেকোনো ভয়েস প্রম্পটে চাপুন..." : "Tap any voice prompt below...";
      return;
    }

    try {
      this.recognition.lang = this.lang;
      this.recognition.continuous = RobotController.handsFreeMode;
      this.isStarting = true;
      this.recognition.start();
    } catch (e) {
      this.isStarting = false;
      console.warn("Speech recognition retry:", e);
      try {
        this.recognition.abort();
        this.createRecognition();
        this.isStarting = true;
        this.recognition.start();
      } catch (err2) {
        this.isStarting = false;
        AudioVisualizer.startMic();
        const robotTrans = document.getElementById("robotUserTranscript");
        if (robotTrans) robotTrans.textContent = this.lang.startsWith("bn")
          ? "মাইক্রোফোন চালু করা যায়নি। আবার চেষ্টা করুন।"
          : "Could not start the microphone. Please try again.";
        if (RobotController.handsFreeMode) {
          showToast(this.lang.startsWith("bn")
            ? "অবিচ্ছিন্ন ভয়েস ইনপুট শুরু করা যায়নি। আবার চেষ্টা করুন।"
            : "Hands-free listening could not start. Please try again.", "danger");
        }
      }
    }
  },

  submitRecognizedTranscript() {
    clearTimeout(this.transcriptTimer);
    this.transcriptTimer = null;
    const query = normalizeVoiceTranscript(this.pendingTranscript);
    this.pendingTranscript = "";
    this.lastTranscript = "";
    if (query && this.captureCallback) {
      const callback = this.captureCallback;
      this.captureCallback = null;
      this.stopListening();
      callback(query);
      return;
    }
    if (!query || RobotController.isAnswering) return;

    RobotController.isAnswering = true;
    this.stopListening();
    handleRobotQuerySubmission(query);
  },

  stopListening() {
    this.isListening = false;
    this.isStarting = false;
    if (this.recognition) {
      try { this.recognition.stop(); } catch (e) {}
    }
    this.updateVisualizerState("IDLE");
    AudioVisualizer.stopMic();
    if (!this.isSpeaking) {
      RobotController.setState("IDLE");
    }
  },

  speak(text) {
    if (!text) return;
    const cleanText = cleanSpeechText(text).replace(/[*#_•]/g, "").trim();
    if (!cleanText) return;

    this.stopSpeaking();
    const generation = this.speechGeneration;
    const controller = new AbortController();
    this.audioRequestController = controller;
    this.isSpeaking = true;
    this.updateVisualizerState("SPEAKING");
    AudioVisualizer.setSpeaking(true);
    document.getElementById("robotStopBtn")?.removeAttribute("hidden");

    fetch("/api/speech", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: cleanText }),
      signal: controller.signal,
    })
      .then(async response => {
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.error || `Speech request failed (${response.status})`);
        }
        return response.blob();
      })
      .then(blob => {
        if (generation !== this.speechGeneration) return;
        this.audioRequestController = null;
        this.audioObjectUrl = URL.createObjectURL(blob);
        const audio = new Audio(this.audioObjectUrl);
        this.audioElement = audio;
        audio.playbackRate = this.speechRate;
        audio.onended = () => this.finishSpeech(generation);
        audio.onerror = () => this.fallbackToBrowser(cleanText, new Error("ElevenLabs audio could not be played"), generation);
        return audio.play().catch(error => {
          this.fallbackToBrowser(cleanText, error, generation);
        });
      })
      .catch(error => {
        if (error.name !== "AbortError") {
          this.fallbackToBrowser(cleanText, error, generation);
        }
      });
  },

  speakWithBrowser(text, generation) {
    if (!("speechSynthesis" in window)) {
      this.finishSpeech(generation);
      console.warn("Speech playback is unavailable in this browser.");
      showToast("Voice playback is unavailable in this browser. The answer is still shown as text.", "info");
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = this.speechRate;
    utterance.pitch = 0.95;
    utterance.lang = this.lang;

    if (this.selectedVoice) {
      utterance.voice = this.selectedVoice;
    }

    utterance.onstart = () => {
      if (generation !== this.speechGeneration) return;
      this.isSpeaking = true;
      this.updateVisualizerState("SPEAKING");
      AudioVisualizer.setSpeaking(true);
      RobotController.setState("SPEAKING");
      document.getElementById("robotStopBtn")?.removeAttribute("hidden");
    };

    const cleanup = () => {
      this.finishSpeech(generation);
    };

    utterance.onend = cleanup;
    utterance.onerror = cleanup;

    setTimeout(() => {
      if (generation !== this.speechGeneration) return;
      if (window.speechSynthesis.paused) window.speechSynthesis.resume();
      window.speechSynthesis.speak(utterance);
    }, 40);
  },

  fallbackToBrowser(text, error, generation) {
    if (generation !== this.speechGeneration) return;
    const fallbackGeneration = ++this.speechGeneration;
    if (!this.fallbackNoticeShown) {
      console.warn("ElevenLabs speech failed; falling back to browser speech:", error);
      this.fallbackNoticeShown = true;
    }
    this.audioRequestController?.abort();
    this.audioRequestController = null;
    this.releaseAudio();
    this.speakWithBrowser(text, fallbackGeneration);
  },

  finishSpeech(generation) {
    if (generation !== this.speechGeneration) return;
    this.audioRequestController = null;
    this.releaseAudio();
    this.isSpeaking = false;
    this.updateVisualizerState("IDLE");
    AudioVisualizer.setSpeaking(false);
    RobotController.setState("IDLE");
    document.getElementById("robotStopBtn")?.setAttribute("hidden", "true");
    RobotController.finishAnswer();
  },

  releaseAudio() {
    if (this.audioElement) {
      this.audioElement.pause();
      this.audioElement.removeAttribute("src");
      this.audioElement.load();
      this.audioElement = null;
    }
    if (this.audioObjectUrl) {
      URL.revokeObjectURL(this.audioObjectUrl);
      this.audioObjectUrl = null;
    }
  },

  stopSpeaking() {
    this.speechGeneration += 1;
    this.audioRequestController?.abort();
    this.audioRequestController = null;
    this.releaseAudio();
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    this.isSpeaking = false;
    this.updateVisualizerState("IDLE");
    AudioVisualizer.setSpeaking(false);
    RobotController.setState("IDLE");
    document.getElementById("speakingBanner")?.setAttribute("hidden", "true");
    document.getElementById("stopSpeechBtn")?.setAttribute("hidden", "true");
  },

  updateVisualizerState(state) {
    RobotController.setState(state);
    const viz = document.getElementById("visualizerContainer");
    const statusText = document.getElementById("voiceStatusText");
    const chatMic = document.getElementById("chatMicBtn");

    if (viz) {
      viz.classList.remove("state-listening", "state-thinking", "state-speaking");
      if (state === "LISTENING") {
        viz.classList.add("state-listening");
        if (statusText) statusText.textContent = "LISTENING... SPEAK YOUR QUESTION";
        chatMic?.classList.add("active-listening");
      } else if (state === "THINKING") {
        viz.classList.add("state-thinking");
        if (statusText) statusText.textContent = "PROCESSING YOUR QUESTION...";
        chatMic?.classList.remove("active-listening");
      } else if (state === "SPEAKING") {
        viz.classList.add("state-speaking");
        if (statusText) statusText.textContent = "🔊 SPEAKING ANSWER...";
        chatMic?.classList.remove("active-listening");
      } else {
        if (statusText) statusText.textContent = "TAP TO SPEAK";
        chatMic?.classList.remove("active-listening");
      }
    }
  }
};

// ============================================================================
// 6. ROBOTIC FACE CONTROLLER & VOICE AI ENGINE
// ============================================================================

const RobotController = {
  state: "IDLE",
  currentAnswer: "Hello. I can answer questions using information provided by an administrator.",
  lastQuery: "",
  isMuted: false,
  autoVoice: true,
  handsFreeMode: false,
  isAnswering: false,
  handsFreeRestartTimer: null,
  currentExpressionIndex: 0,
  expressions: ["normal"],

  init() {
    this.bindEvents();
    this.setExpression("normal");
    document.addEventListener("fullscreenchange", () => {
      const view = document.getElementById("view-robot");
      if (this.handsFreeMode && document.fullscreenElement !== view) {
        this.disableHandsFree(false);
      }
    });
  },

  async enableHandsFree() {
    const view = document.getElementById("view-robot");
    if (!view) return;

    this.handsFreeMode = true;
    view.classList.add("hands-free-active");
    const button = document.getElementById("robotHandsFreeBtn");
    if (button) {
      button.setAttribute("aria-pressed", "true");
      button.innerHTML = '<span aria-hidden="true">✕</span> Exit hands-free';
      button.setAttribute("aria-label", "Exit fullscreen hands-free listening mode");
    }

    this.isAnswering = false;
    let fullscreenRequest;
    if (view.requestFullscreen && !document.fullscreenElement) {
      try {
        fullscreenRequest = view.requestFullscreen();
      } catch (error) {
        console.warn("Fullscreen mode unavailable; using the in-page hands-free view.", error);
      }
    }

    SpeechEngine.startListening();
    if (fullscreenRequest) {
      try {
        await fullscreenRequest;
      } catch (error) {
        console.warn("Fullscreen mode unavailable; using the in-page hands-free view.", error);
      }
    }
  },

  disableHandsFree(exitFullscreen = true) {
    this.handsFreeMode = false;
    this.isAnswering = false;
    clearTimeout(this.handsFreeRestartTimer);
    this.handsFreeRestartTimer = null;
    const handsFreeAudio = document.getElementById("robotHandsFreeAudio");
    if (handsFreeAudio) {
      handsFreeAudio.pause();
      handsFreeAudio.currentTime = 0;
    }
    const view = document.getElementById("view-robot");
    view?.classList.remove("hands-free-active");
    const button = document.getElementById("robotHandsFreeBtn");
    if (button) {
      button.setAttribute("aria-pressed", "false");
      button.innerHTML = '<span aria-hidden="true">⛶</span> Hands-free';
      button.setAttribute("aria-label", "Open fullscreen hands-free listening mode");
    }
    if (SpeechEngine.isListening) SpeechEngine.stopListening();
    if (exitFullscreen && document.fullscreenElement === view && document.exitFullscreen) {
      document.exitFullscreen().catch(error => {
        console.warn("Could not exit fullscreen mode.", error);
      });
    }
  },

  resumeHandsFreeListening() {
    clearTimeout(this.handsFreeRestartTimer);
    const handsFreeAudio = document.getElementById("robotHandsFreeAudio");
    if (!this.handsFreeMode || this.isAnswering || SpeechEngine.isSpeaking || SpeechEngine.isListening
      || (handsFreeAudio && !handsFreeAudio.paused)) return;
    this.handsFreeRestartTimer = setTimeout(() => {
      this.handsFreeRestartTimer = null;
      if (this.handsFreeMode && !this.isAnswering && !SpeechEngine.isSpeaking && !SpeechEngine.isListening
        && (!handsFreeAudio || handsFreeAudio.paused)) {
        SpeechEngine.startListening();
      }
    }, 300);
  },

  async playHandsFreeVoice() {
    const audio = document.getElementById("robotHandsFreeAudio");
    if (!audio) {
      showToast("The hands-free voice audio could not be found.", "danger");
      return;
    }

    if (SpeechEngine.isListening) SpeechEngine.stopListening();
    if (SpeechEngine.isSpeaking) SpeechEngine.stopSpeaking();
    clearTimeout(this.handsFreeRestartTimer);
    this.handsFreeRestartTimer = null;
    audio.currentTime = 0;

    try {
      await audio.play();
    } catch (error) {
      console.error("Hands-free voice playback failed:", error);
      showToast("The hands-free voice could not be played. Check the audio file and try again.", "danger");
      this.resumeHandsFreeListening();
    }
  },

  finishAnswer() {
    this.isAnswering = false;
    this.resumeHandsFreeListening();
  },

  setExpression(exprName) {
    const face = document.getElementById("face");
    if (!face) return;

    // The robotic face is configured to remain consistently normal with a gentle pleasant smile
    face.classList.remove("sad", "angry", "cring", "laughing", "surprised", "teasing");
    face.classList.add("normal");
  },

  cycleExpression() {
    this.setExpression("normal");
  },

  setupExpressionButton() {
    // Expression toggle removed per specification
  },

  setState(state) {
    this.state = state;
    const face = document.getElementById("face");
    const statusText = document.getElementById("robotStatusText");
    const micBtn = document.getElementById("robotBigMicBtn");
    const micCaption = document.getElementById("robotMicCaption");
    const stopBtn = document.getElementById("robotStopBtn");
    const replayBtn = document.getElementById("robotReplayBtn");
    const beacon = document.getElementById("statusBeaconDot");

    this.setExpression("normal");

    if (state === "LISTENING") {
      face?.classList.remove("talking");
      if (statusText) statusText.textContent = "LISTENING... SPEAK YOUR QUESTION";
      if (micBtn) micBtn.classList.add("is-active");
      if (micCaption) micCaption.textContent = "LISTENING... (TAP TO SEND)";
      if (beacon) beacon.style.background = "#ffb703";
      if (stopBtn) stopBtn.hidden = true;
    } else if (state === "THINKING") {
      face?.classList.remove("talking");
      if (statusText) statusText.textContent = "PROCESSING YOUR QUESTION...";
      if (micBtn) micBtn.classList.remove("is-active");
      if (micCaption) micCaption.textContent = "PROCESSING...";
      if (beacon) beacon.style.background = "#38d9ff";
      if (stopBtn) stopBtn.hidden = true;
    } else if (state === "SPEAKING") {
      face?.classList.add("talking");
      if (statusText) statusText.textContent = "🔊 ROBOT AI SPEAKING ANSWER...";
      if (micBtn) micBtn.classList.remove("is-active");
      if (micCaption) micCaption.textContent = "AI SPEAKING...";
      if (beacon) beacon.style.background = "#06d6a0";
      if (stopBtn) stopBtn.hidden = false;
      if (replayBtn) replayBtn.hidden = false;
    } else {
      // IDLE
      face?.classList.remove("talking");
      if (statusText) statusText.textContent = "STANDBY · READY TO TALK";
      if (micBtn) micBtn.classList.remove("is-active");
      if (micCaption) micCaption.textContent = "TAP TO SPEAK";
      if (beacon) beacon.style.background = "#38bdf8";
      if (stopBtn) stopBtn.hidden = true;
      if (replayBtn && this.currentAnswer) {
        replayBtn.hidden = false;
      }
    }
  },

  bindEvents() {
    const handsFreeButton = document.getElementById("robotHandsFreeBtn");
    handsFreeButton?.addEventListener("click", () => {
      if (this.handsFreeMode) {
        this.disableHandsFree();
      } else {
        this.enableHandsFree();
      }
    });

    const handsFreeAudioButton = document.getElementById("robotHandsFreeAudioBtn");
    handsFreeAudioButton?.addEventListener("click", () => this.playHandsFreeVoice());
    document.getElementById("robotHandsFreeAudio")?.addEventListener("ended", () => {
      this.resumeHandsFreeListening();
    });
    document.querySelector(".robot-hands-free-prompts")?.addEventListener("click", event => {
      const button = event.target.closest("button[data-question]");
      if (button) handleRobotQuerySubmission(button.dataset.question);
    });

    // Big Mic Button
    const bigMic = document.getElementById("robotBigMicBtn");
    bigMic?.addEventListener("click", () => {
      if (this.handsFreeMode) {
        if (SpeechEngine.isListening) SpeechEngine.stopListening();
        this.resumeHandsFreeListening();
        return;
      }
      if (SpeechEngine.isListening) {
        SpeechEngine.stopListening();
      } else {
        if (SpeechEngine.isSpeaking) SpeechEngine.stopSpeaking();
        SpeechEngine.startListening();
      }
    });

    // Replay Voice Button
    const replayBtn = document.getElementById("robotReplayBtn");
    replayBtn?.addEventListener("click", () => {
      if (this.currentAnswer && !this.isMuted) {
        SpeechEngine.speak(this.currentAnswer);
      }
    });

    // Stop Voice Button
    const stopBtn = document.getElementById("robotStopBtn");
    stopBtn?.addEventListener("click", () => {
      SpeechEngine.stopSpeaking();
      this.finishAnswer();
    });

    // Voice Speed
    const speedSelect = document.getElementById("robotSpeechRate");
    speedSelect?.addEventListener("change", (e) => {
      SpeechEngine.speechRate = parseFloat(e.target.value) || 1.0;
      if (SpeechEngine.audioElement) {
        SpeechEngine.audioElement.playbackRate = SpeechEngine.speechRate;
      }
    });

    // Auto-Speak Toggle
    const autoVoiceToggle = document.getElementById("autoVoiceToggle");
    autoVoiceToggle?.addEventListener("change", (e) => {
      this.autoVoice = e.target.checked;
    });

    // Mute Audio Toggle
    const muteToggle = document.getElementById("robotMuteToggle");
    muteToggle?.addEventListener("change", (e) => {
      this.isMuted = e.target.checked;
      if (this.isMuted && SpeechEngine.isSpeaking) {
        SpeechEngine.stopSpeaking();
      }
    });

    // Header sound toggle button
    const headerSoundBtn = document.getElementById("soundToggleBtn");
    headerSoundBtn?.addEventListener("click", () => {
      this.isMuted = !this.isMuted;
      if (muteToggle) muteToggle.checked = this.isMuted;
      const icon = document.getElementById("soundToggleIcon");
      if (icon) icon.textContent = this.isMuted ? "🔇" : "🔊";
      if (this.isMuted && SpeechEngine.isSpeaking) {
        SpeechEngine.stopSpeaking();
      }
    });

    // Voice Prompt Quick Buttons
    document.querySelectorAll(".voice-cmd-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const isBn = SpeechEngine.lang.startsWith("bn");
        const query = isBn
          ? (btn.getAttribute("data-query-bn") || btn.getAttribute("data-query"))
          : btn.getAttribute("data-query");
        if (query) {
          handleRobotQuerySubmission(query);
        }
      });
    });
  }
};

function updateUiLanguage(langCode) {
  const isBn = langCode === "bn";
  const enBtn = document.getElementById("langEnBtn");
  const bnBtn = document.getElementById("langBnBtn");
  if (enBtn && bnBtn) {
    if (isBn) {
      bnBtn.classList.add("active");
      enBtn.classList.remove("active");
    } else {
      enBtn.classList.add("active");
      bnBtn.classList.remove("active");
    }
  }

  document.documentElement.lang = isBn ? "bn" : "en";

  // Navigation Links
  const navRobot = document.querySelector(".nav-links [data-view='robot']");
  if (navRobot) navRobot.textContent = isBn ? "🤖 ভয়েস অ্যাসিস্ট্যান্ট" : "🤖 Voice AI Assistant";
  const navAdmin = document.querySelector(".nav-links [data-view='admin']");
  if (navAdmin) navAdmin.textContent = isBn ? "⚙️ অ্যাডমিন কনসোল" : "⚙️ Admin Control Panel";

  // Mobile Nav
  const mNavRobot = document.querySelector(".mobile-nav-inner [data-view='robot']");
  if (mNavRobot) mNavRobot.textContent = isBn ? "🤖 ভয়েস অ্যাসিস্ট্যান্ট" : "🤖 Voice AI Assistant";
  const mNavAdmin = document.querySelector(".mobile-nav-inner [data-view='admin']");
  if (mNavAdmin) mNavAdmin.textContent = isBn ? "⚙️ অ্যাডমিন কনসোল" : "⚙️ Admin Control Panel";

  // Hero Headline
  const badge = document.querySelector(".robot-core-badge");
  if (badge) badge.textContent = isBn ? "মির্জাপুর ক্যাডেট কলেজ · প্রাতিষ্ঠানিক তথ্যভাণ্ডার" : "MIRZAPUR CADET COLLEGE · KNOWLEDGE REPOSITORY";
  const mainTitle = document.querySelector(".robot-main-title");
  if (mainTitle) mainTitle.textContent = isBn ? "মির্জাপুর ক্যাডেট কলেজ নলেজ অ্যাসিস্ট্যান্ট" : "Mirzapur Cadet College Knowledge Assistant";
  const mainSub = document.querySelector(".robot-main-subtitle");
  if (mainSub) mainSub.textContent = isBn
    ? "প্রাতিষ্ঠানিক ভয়েস ও জ্ঞান সহকারী। কথা বলে জানুন কলেজের ইতিহাস, প্রশাসন, শিক্ষক, ক্যাডেট ব্যাচ ও হাউস সম্পর্কিত তথ্য।"
    : "Institutional voice and knowledge assistant. Inquire via speech regarding college history, administration, faculty, cadet batches, houses, facilities, and verified archives.";

  // Status HUD
  const statusText = document.getElementById("robotStatusText");
  if (statusText && RobotController.state === "IDLE") {
    statusText.textContent = isBn ? "সিস্টেম প্রস্তুত · ভয়েস সক্রিয়" : "SYSTEM READY · VOICE ACTIVE";
  }
  const micCaption = document.getElementById("robotMicCaption");
  if (micCaption && RobotController.state === "IDLE") {
    micCaption.textContent = isBn ? "কথা বলতে চাপুন" : "TAP TO SPEAK";
  }

  // Voice Deck
  const inqTag = document.getElementById("voiceInquiryTag");
  if (inqTag) inqTag.textContent = isBn ? "🎙️ ভয়েস ইনপুট" : "🎙️ VOICE INPUT";
  const transEl = document.getElementById("robotUserTranscript");
  if (transEl && (!SpeechEngine.isSpeaking && !SpeechEngine.isListening)) {
    transEl.textContent = isBn ? "মাইক্রোফোনে কথা বলুন অথবা নিচের প্রম্পট বেছে নিন..." : "Tap the microphone to speak or choose a voice prompt below...";
  }

  // Quick Prompts
  const qTitle = document.getElementById("quickCmdsTitle");
  if (qTitle) qTitle.textContent = isBn ? "🎙️ ভয়েস কমান্ড:" : "🎙️ Voice Prompts:";
  const replayLabel = document.getElementById("replayBtnLabel");
  if (replayLabel) replayLabel.textContent = isBn ? "🔊 পুনরায় শুনুন" : "🔊 Replay Voice";
  const stopLabel = document.getElementById("stopBtnLabel");
  if (stopLabel) stopLabel.textContent = isBn ? "⏹️ থামান" : "⏹️ Stop Voice";
  const speedLabel = document.getElementById("voiceSpeedLabel");
  if (speedLabel) speedLabel.textContent = isBn ? "ভয়েস গতি:" : "Voice Speed:";

  // Voice command buttons text
  document.querySelectorAll(".voice-cmd-btn").forEach(btn => {
    const qBn = btn.getAttribute("data-query-bn");
    const qEn = btn.getAttribute("data-query");
    const span = btn.querySelector("span");
    if (span) {
      span.textContent = isBn
        ? `🎙️ ${qBn ? qBn.replace(" কে?", "").replace(" বলো", "") : ""}`
        : `🎙️ ${qEn.replace("Who is the ", "").replace("Who is ", "").replace("Tell me about ", "").replace("What is the ", "")}`;
    }
  });
}

let spotlightTimer = null;

function showPersonSpotlight(person) {
  if (!person) return;
  const card = document.getElementById("personSpotlightCard");
  const photoEl = document.getElementById("spotlightPhoto");
  const nameEl = document.getElementById("spotlightName");
  const roleEl = document.getElementById("spotlightRole");
  const extraEl = document.getElementById("spotlightExtra");
  const badgeEl = document.getElementById("spotlightBadgeText");
  const timerBar = document.getElementById("spotlightTimerBar");

  if (!card) return;

  if (spotlightTimer) {
    clearTimeout(spotlightTimer);
    spotlightTimer = null;
  }

  if (nameEl) nameEl.textContent = person.name || "Record";
  if (roleEl) roleEl.textContent = person.position || person.role || formatClassNumber(person.className) || person.profession || "Institutional Member";
  if (extraEl) {
    const extraParts = [];
    if (person.cadetNumber) extraParts.push(`C.No: ${person.cadetNumber}`);
    if (person.batch) extraParts.push(`Batch ${person.batch}`);
    if (person.house) extraParts.push(`${person.house} House`);
    if (person.department) extraParts.push(person.department);
    if (person.organization) extraParts.push(person.organization);
    extraEl.textContent = extraParts.slice(0, 2).join(" · ") || "Administrator-provided record";
  }
  if (badgeEl) {
    if (person.position) badgeEl.textContent = "COLLEGE FACULTY";
    else if (person.batch && (person.graduationYear || person.role)) badgeEl.textContent = "DISTINGUISHED ALUMNUS";
    else if (person.className) badgeEl.textContent = "CURRENT CADET";
    else badgeEl.textContent = "ADMIN RECORD";
  }

  if (photoEl) {
    const fallbackSrc = "./assets/mcc-college-logo.png";
    const personPhoto = person.photo && person.photo.trim();
    photoEl.classList.toggle("spotlight-avatar-logo", !personPhoto);
    photoEl.alt = personPhoto
      ? `Portrait of ${person.name || "institutional member"}`
      : "Mirzapur Cadet College crest";
    photoEl.src = personPhoto || fallbackSrc;
  }

  // Reset and trigger the 5s timer bar animation
  if (timerBar) {
    timerBar.style.animation = "none";
    void timerBar.offsetWidth;
    timerBar.style.animation = "spotlightCountdown 5s linear forwards";
  }

  // Reveal the card on one side of the face
  card.classList.add("is-active");

  // Keep visible for exactly 5 seconds, then hide smoothly
  spotlightTimer = setTimeout(() => {
    card.classList.remove("is-active");
    spotlightTimer = null;
  }, 5000);
}

function findPersonFromContext(query, answerText) {
  const q = normalizeSampleQuestionText(query);
  const a = normalizeSampleQuestionText(answerText);
  const administration = Array.isArray(DB.administrationData) ? DB.administrationData : [];
  const alumni = Array.isArray(DB.alumniData) ? DB.alumniData : [];
  const cadets = Array.isArray(DB.cadetsData) ? DB.cadetsData : [];
  const includesText = (text, value) => {
    const normalized = normalizeSampleQuestionText(value);
    return Boolean(normalized && text.includes(normalized));
  };

  // 1. Leadership designations
  if (q.includes("vice principal") || q.includes("উপাধ্যক্ষ")) {
    const vp = administration.find(adm => includesText(adm.position, "vice principal"));
    if (vp) return vp;
  }
  if (q.includes("principal") || q.includes("অধ্যক্ষ") || q.includes("প্রিন্সিপাল")) {
    const p = administration.find(adm => includesText(adm.position, "principal") && adm.status === "current");
    if (p) return p;
  }
  if (q.includes("adjutant") || q.includes("এডজুট্যান্ট")) {
    const adj = administration.find(adm => includesText(adm.position, "adjutant"));
    if (adj) return adj;
  }
  if (q.includes("founder") || q.includes("প্রতিষ্ঠাতা") || q.includes("maurice brown") || q.includes("william maurice")) {
    const f = administration.find(adm => includesText(adm.position, "founder") || includesText(adm.name, "brown"));
    if (f) return f;
  }

  // 2. Administration directory scan
  for (const adm of administration) {
    if (adm.name && (includesText(q, adm.name) || includesText(a, adm.name))) {
      return adm;
    }
  }

  // 3. Alumni directory scan
  for (const alm of alumni) {
    if (alm.name && (includesText(q, alm.name) || includesText(a, alm.name))) {
      return alm;
    }
    if (alm.cadetNumber && (includesText(q, alm.cadetNumber) || includesText(a, alm.cadetNumber))) {
      return alm;
    }
  }

  // 4. Cadets roster scan
  for (const cdt of cadets) {
    if (cdt.name && (includesText(q, cdt.name) || includesText(a, cdt.name))) {
      return cdt;
    }
    if (cdt.cadetNumber && (includesText(q, cdt.cadetNumber) || includesText(a, cdt.cadetNumber))) {
      return cdt;
    }
    if (cdt.className && (includesText(q, cdt.className) || includesText(a, cdt.className) || q.match(/\b(?:class|ক্লাস)\s*(7|8|9|10|11|12)\b/) && includesText(q, formatClassNumber(cdt.className)))) {
      return cdt;
    }
  }

  return null;
}

function displayAndSpeakAnswer(result) {
  const answerText = cleanSpeechText(result.text);
  RobotController.currentAnswer = answerText;

  // Display in Robot Answer Bubble
  const answerEl = document.getElementById("robotAnswerText");
  const verifiedEl = document.getElementById("robotAnswerVerified");
  const sourceEl = document.getElementById("robotSourceMeta");

  if (answerEl) {
    answerEl.textContent = answerText;
  }

  if (verifiedEl) {
    verifiedEl.textContent = result.notFound
      ? "⚠ Information Not Found"
      : result.verified ? "✓ Verified Record" : "ℹ AI Response";
    verifiedEl.style.color = result.notFound
      ? "var(--color-pending)"
      : result.verified ? "var(--color-verified)" : "var(--color-gold)";
  }

  if (sourceEl) {
    sourceEl.textContent = `Source: ${result.source || "Admin-provided information"} · Last Updated: ${result.lastUpdated || ""}`;
  }

  // Check if a person is queried or returned - show portrait spotlight card for 5 seconds on one side of face.
  // Saved sample-question answers should stay text-only and avoid showing any profile image.
  const isSavedSampleAnswer = result.source === "Saved sample question" || result.classification?.category === "SAMPLE QUESTION";
  const matchedPerson = isSavedSampleAnswer || result.notFound
    ? null
    : result.person || findPersonFromContext(RobotController.lastQuery, answerText);
  if (matchedPerson) {
    showPersonSpotlight(matchedPerson);
  }

  // Voice answer aloud
  if (RobotController.autoVoice && !RobotController.isMuted) {
    SpeechEngine.speak(answerText);
  } else {
    RobotController.setState("IDLE");
    RobotController.finishAnswer();
  }
}

async function handleRobotQuerySubmission(query) {
  if (!query || !query.trim()) return;
  const cleanQ = query.trim();
  RobotController.lastQuery = cleanQ;

  if (SpeechEngine.isListening) SpeechEngine.stopListening();
  if (SpeechEngine.isSpeaking) SpeechEngine.stopSpeaking();

  const transcriptEl = document.getElementById("robotUserTranscript");
  if (transcriptEl) transcriptEl.textContent = `"${cleanQ}"`;
  RobotController.setState("THINKING");

  try {
    const result = await generateAnswer(cleanQ);
    displayAndSpeakAnswer(result);
  } catch (error) {
    console.error("Robot answer generation failed:", error);
    displayAndSpeakAnswer({
      text: "Sorry, I couldn't answer right now. Please try again.",
      verified: false,
      source: "Assistant",
      lastUpdated: "",
      notFound: true
    });
  }
}

function displayHomeAnswerCard(result) {
  const card = document.getElementById("homeAnswerCard");
  const body = document.getElementById("homeAnsBody");
  const verified = document.getElementById("homeAnsVerified");
  const source = document.getElementById("homeAnsSource");
  const replayBtn = document.getElementById("homeAnsReplayBtn");

  if (!card || !body) return;

  const answerText = cleanSpeechText(result.text);
  const paragraphs = answerText.split("\n").map(p => `<p>${escapeHtml(p)}</p>`).join("");
  body.innerHTML = paragraphs;

  if (verified) {
    verified.textContent = result.notFound
      ? "⚠ Information Not Found"
      : result.verified ? "✓ Verified Record" : "⚠ Unverified response";
    verified.style.color = result.verified ? "var(--color-verified)" : "var(--color-pending)";
  }

  if (source) {
    source.textContent = `Source: ${result.source || "Admin-provided information"} · Last Updated: ${result.lastUpdated || ""}`;
  }

  if (replayBtn) {
    replayBtn.setAttribute("data-speech", answerText);
  }

  card.removeAttribute("hidden");
}

async function handleQuerySubmission(query) {
  if (!query || !query.trim()) return;
  const cleanQ = query.trim();
  const transcriptEl = document.getElementById("robotUserTranscript");
  if (transcriptEl) transcriptEl.textContent = `"${cleanQ}"`;

  appendUserMessage(cleanQ);
  SpeechEngine.updateVisualizerState("THINKING");
  const chatStatus = document.getElementById("chatStatusBar");
  if (chatStatus) chatStatus.removeAttribute("hidden");

  try {
    const result = await generateAnswer(cleanQ);
    result.text = cleanSpeechText(result.text);
    const answerEl = document.getElementById("robotAnswerText");
    if (answerEl) answerEl.textContent = result.text;
    updateContextDisplay(result.classification);
    appendAiMessage(result);
    displayHomeAnswerCard(result);
    SpeechEngine.speak(result.text);
  } catch (error) {
    console.error("Chat answer generation failed:", error);
    const fallback = {
      text: "Sorry, I couldn't answer right now. Please try again.",
      classification: { category: "UNKNOWN", intent: "ANSWER_ERROR", name: null, batch: null, house: null },
      verified: false,
      source: "Assistant",
      lastUpdated: "",
      notFound: true
    };
    const answerEl = document.getElementById("robotAnswerText");
    if (answerEl) answerEl.textContent = fallback.text;
    updateContextDisplay(fallback.classification);
    appendAiMessage(fallback);
    displayHomeAnswerCard(fallback);
    SpeechEngine.speak(fallback.text);
  } finally {
    if (chatStatus) chatStatus.setAttribute("hidden", "true");
  }
}

function appendUserMessage(text) {
  const stream = document.getElementById("chatStream");
  if (!stream) return;

  const bubble = document.createElement("div");
  bubble.className = "chat-bubble user-bubble";
  bubble.innerHTML = `
    <div class="bubble-header">You</div>
    <div class="bubble-content"><p>${escapeHtml(text)}</p></div>
  `;
  stream.appendChild(bubble);
  stream.scrollTop = stream.scrollHeight;
}

function appendAiMessage(result) {
  const stream = document.getElementById("chatStream");
  if (!stream) return;

  const bubble = document.createElement("div");
  bubble.className = "chat-bubble ai-bubble";

  const answerText = cleanSpeechText(result.text);
  const paragraphs = answerText.split("\n").map(p => `<p>${escapeHtml(p)}</p>`).join("");
  const verifiedBadge = result.verified
    ? `<span class="verified-tag">✓ Verified Record</span>`
    : `<span style="color:var(--color-pending); font-size:0.75rem;">⚠ ${result.notFound ? "Information Not Found" : "Unverified"}</span>`;

  bubble.innerHTML = `
    <div class="bubble-header">
      <span class="speaker-name">MCC AI</span>
      ${verifiedBadge}
    </div>
    <div class="bubble-content">
      ${paragraphs}
    </div>
    <div class="bubble-meta-footer">
      <span>Source: ${result.source || "Admin-provided information"}</span>
      <span>Updated: ${result.lastUpdated || ""}</span>
    </div>
    <div class="bubble-actions">
      <button type="button" class="btn-speech-replay" data-speech="${escapeHtml(answerText)}">
        <span>🔊 Play Again</span>
      </button>
    </div>
  `;

  stream.appendChild(bubble);
  stream.scrollTop = stream.scrollHeight;

  // Bind replay handler
  bubble.querySelector(".btn-speech-replay").addEventListener("click", function() {
    SpeechEngine.speak(this.getAttribute("data-speech"));
  });
}

function updateContextDisplay(cls) {
  const pEl = document.getElementById("ctxPerson");
  const bEl = document.getElementById("ctxBatch");
  const cEl = document.getElementById("ctxCategory");
  const jsonEl = document.getElementById("classResultJson");

  if (pEl) pEl.textContent = "None";
  if (bEl) bEl.textContent = "None";
  if (cEl) cEl.textContent = cls.category;
  if (jsonEl) {
    jsonEl.textContent = JSON.stringify({
      category: cls.category,
      intent: cls.intent,
      entity: "administrator-provided information"
    }, null, 2);
  }
}

// ============================================================================
// 7. SPA ROUTER & VIEW RENDERING
// ============================================================================

function switchView(viewId) {
  // Enforce single-panel contract: Only 'robot' and 'admin' panels exist
  if (viewId !== "admin") {
    viewId = "robot";
  }

  // Update desktop nav buttons
  document.querySelectorAll(".nav-btn").forEach(btn => {
    btn.classList.toggle("active", btn.getAttribute("data-view") === viewId);
  });

  // Update mobile nav buttons
  document.querySelectorAll(".mobile-nav-btn").forEach(btn => {
    btn.classList.toggle("active", btn.getAttribute("data-view") === viewId);
  });

  // Update footer nav buttons
  document.querySelectorAll(".f-link").forEach(btn => {
    btn.classList.toggle("active", btn.getAttribute("data-view") === viewId);
  });

  // Hide mobile drawer
  const drawer = document.getElementById("mobileNavDrawer");
  if (drawer) drawer.hidden = true;
  const hamburger = document.getElementById("hamburgerBtn");
  if (hamburger) hamburger.setAttribute("aria-expanded", "false");

  // Switch View Containers
  document.querySelectorAll(".spa-view").forEach(view => {
    const isTarget = view.id === `view-${viewId}`;
    view.classList.toggle("active", isTarget);
    if (isTarget) {
      view.removeAttribute("hidden");
    } else {
      view.setAttribute("hidden", "true");
    }
  });

  // Scroll to top
  window.scrollTo({ top: 0, behavior: "smooth" });

  // Trigger view-specific operations
  if (viewId === "admin") {
    checkAdminSession();
  } else if (viewId === "robot") {
    AudioVisualizer.resize();
  }
}

// ============================================================================
// 8. SECTION RENDERERS
// ============================================================================

// --- College Subviews ---
function renderCollegeSection(subview) {
  const container = document.getElementById("collegeSubcontent");
  if (!container) return;

  const history = DB.collegeData.history;
  const academics = DB.collegeData.academics;
  const emptyMessage = "No information has been added by an administrator yet.";

  if (subview === "overview" || subview === "history") {
    const title = subview === "overview" ? "Institution Overview" : "History";
    const details = [
      ["Title", history.title],
      ["Motto", history.motto],
      ["Established", history.established],
      ["Foundation Date", history.foundationDate],
      ["Founded By", history.foundationLaidBy],
      ["Inauguration Date", history.inaugurationDate],
      ["Inaugurated By", history.inauguratedBy],
      ["First Principal", history.firstPrincipal],
      ["Area", history.area],
      ["Location", history.district]
    ].filter(([, value]) => value);
    container.innerHTML = `
      <div class="college-prose-card">
        <h3>${title}</h3>
        ${history.content ? `<p style="font-size:1.02rem; line-height:1.75; color:var(--text-primary); margin-bottom:1.25rem;">${escapeHtml(history.content)}</p>` : `<p>${emptyMessage}</p>`}
        ${details.length ? `<div class="college-meta-grid" style="margin-top:1.5rem;">${details.map(([label, value]) => `<div class="college-meta-item"><span class="c-meta-label">${escapeHtml(label)}</span><span class="c-meta-val">${escapeHtml(value)}</span></div>`).join("")}</div>` : ""}
      </div>
    `;
  } else if (subview === "academics") {
    const lists = [
      ["Disciplines", academics.disciplines],
      ["Laboratories", academics.labs]
    ].filter(([, values]) => values.length);
    container.innerHTML = `
      <div class="college-prose-card">
        <h3>Academic Information</h3>
        ${academics.curriculum ? `<p><strong>Curriculum:</strong> ${escapeHtml(academics.curriculum)}</p>` : ""}
        ${academics.classes ? `<p><strong>Classes:</strong> ${escapeHtml(academics.classes)}</p>` : ""}
        ${lists.map(([label, values]) => `<p><strong>${label}:</strong> ${values.map(escapeHtml).join(", ")}</p>`).join("")}
        ${academics.library ? `<p>${escapeHtml(academics.library)}</p>` : ""}
        ${!academics.curriculum && !academics.classes && !lists.length && !academics.library ? `<p>${emptyMessage}</p>` : ""}
      </div>
    `;
  } else if (subview === "facilities") {
    container.innerHTML = DB.collegeData.facilities.length
      ? `<div class="portal-grid">${DB.collegeData.facilities.map(facility => `<div class="entity-card"><h3 class="entity-name">${escapeHtml(facility.name)}</h3><p class="entity-bio">${escapeHtml(facility.desc || "")}</p></div>`).join("")}</div>`
      : `<div class="empty-state-card"><p>${emptyMessage}</p></div>`;
  } else if (subview === "clubs" || subview === "rules") {
    const values = subview === "clubs" ? DB.collegeData.clubs : DB.collegeData.traditions;
    const title = subview === "clubs" ? "Clubs" : "Traditions";
    container.innerHTML = values.length
      ? `<div class="college-prose-card"><h3>${title}</h3><ul>${values.map(value => `<li>${escapeHtml(value)}</li>`).join("")}</ul></div>`
      : `<div class="empty-state-card"><p>${emptyMessage}</p></div>`;
  }
}

// --- Administration Grid ---
function renderAdministrationGrid(filter = "all", searchQuery = "") {
  const grid = document.getElementById("adminCardsGrid");
  if (!grid) return;

  let records = DB.administrationData;
  if (filter !== "all") {
    records = records.filter(r => r.category === filter);
  }
  if (searchQuery.trim()) {
    const q = searchQuery.toLowerCase();
    records = records.filter(r =>
      r.name.toLowerCase().includes(q) ||
      r.position.toLowerCase().includes(q) ||
      r.department.toLowerCase().includes(q)
    );
  }

  if (!records.length) {
    grid.innerHTML = `<div class="empty-state-card"><div class="empty-icon">🎖️</div><h3 class="empty-title">No administrative personnel found</h3><p class="empty-sub">Try searching with a different role, rank, or subject keyword.</p></div>`;
    return;
  }

    grid.innerHTML = records.map(p => `
    <div class="entity-card">
      <div class="card-top-row">
        <div class="entity-avatar">${p.photo ? `<img src="${p.photo}" alt="${escapeHtml(p.name)}" class="entity-avatar-img">` : "🎖️"}</div>
        <div class="entity-header-text">
          <h3 class="entity-name">${escapeHtml(p.name)}</h3>
          <div class="entity-meta-line">
            <span>${escapeHtml(p.position)}</span>
            <span aria-hidden="true">·</span>
            <span>${escapeHtml(p.department)}</span>
          </div>
        </div>
      </div>
      <p class="entity-bio">${escapeHtml(p.biography)}</p>
      <div class="entity-badge-line">Official: ${escapeHtml(p.officialContact)}</div>
      <div class="card-footer-row">
        <span class="status-verified">✓ Verified</span>
        <div style="display:flex; gap:0.4rem; align-items:center;">
          <button type="button" class="btn-table-action primary" onclick="openEditRecordModal('admin', '${p.id}')">✏️ Edit</button>
          <button type="button" class="card-action-btn view-person-btn" data-type="admin" data-id="${p.id}">View Record</button>
        </div>
      </div>
    </div>
  `).join("");

  bindPersonModalButtons(grid);
}

// --- Cadets Grid ---
function renderCadetsGrid(houseFilter = "all", search = "") {
  const grid = document.getElementById("cadetsGrid");
  if (!grid) return;

  let cadets = DB.cadetsData;
  if (houseFilter !== "all") {
    cadets = cadets.filter(c => c.house === houseFilter);
  }
  if (search.trim()) {
    const q = search.toLowerCase();
    cadets = cadets.filter(c =>
      (c.name || "").toLowerCase().includes(q) ||
      (c.cadetNumber || "").toLowerCase().includes(q) ||
      (c.batch || "").toLowerCase().includes(q) ||
      (c.className || "").toLowerCase().includes(q)
    );
  }

  if (!cadets.length) {
    grid.innerHTML = `<div class="empty-state-card"><div class="empty-icon">🛡️</div><h3 class="empty-title">No cadet records found</h3><p class="empty-sub">Adjust your house filter or search term.</p></div>`;
    return;
  }

  grid.innerHTML = cadets.map(c => {
    const classLabel = c.className ? formatClassNumber(c.className) : "Class N/A";
    const cadetLabel = c.cadetNumber ? `C.No ${escapeHtml(c.cadetNumber)}` : classLabel;
    return `
    <div class="entity-card">
      <div class="card-top-row">
        <div class="entity-avatar">${c.photo ? `<img src="${c.photo}" alt="${escapeHtml(c.name)}" class="entity-avatar-img">` : "👤"}</div>
        <div class="entity-header-text">
          <h3 class="entity-name">${escapeHtml(c.name)}</h3>
          <div class="entity-meta-line">
            <span>${cadetLabel}</span>
            <span aria-hidden="true">·</span>
            <span>Batch ${escapeHtml(c.batch || "N/A")}</span>
            <span aria-hidden="true">·</span>
            <span>${escapeHtml(c.house || "N/A")} House</span>
          </div>
        </div>
      </div>
      <p class="entity-bio">${escapeHtml(c.biography || "")}</p>
      <div class="entity-badge-line">${escapeHtml(classLabel)} · ${escapeHtml(c.section || "Section N/A")}</div>
      <div class="card-footer-row">
        <span class="status-verified">✓ Authorized Registry</span>
        <div style="display:flex; gap:0.4rem; align-items:center;">
          <button type="button" class="btn-table-action primary" onclick="openEditRecordModal('cadet', '${c.id}')">✏️ Edit</button>
          <button type="button" class="card-action-btn view-person-btn" data-type="cadet" data-id="${c.id}">Full Profile</button>
        </div>
      </div>
    </div>
  `;
  }).join("");

  bindPersonModalButtons(grid);
}

// --- Alumni Grid ---
function renderAlumniGrid(professionFilter = "all", search = "") {
  const grid = document.getElementById("alumniGrid");
  if (!grid) return;

  let alumni = DB.alumniData;
  if (professionFilter !== "all") {
    alumni = alumni.filter(a => a.profession.toLowerCase().includes(professionFilter.toLowerCase()));
  }
  if (search.trim()) {
    const q = search.toLowerCase();
    alumni = alumni.filter(a =>
      a.name.toLowerCase().includes(q) ||
      (a.cadetNumber && a.cadetNumber.includes(q)) ||
      a.batch.includes(q) ||
      a.house.toLowerCase().includes(q) ||
      (a.role && a.role.toLowerCase().includes(q)) ||
      (a.organization && a.organization.toLowerCase().includes(q))
    );
  }

  if (!alumni.length) {
    grid.innerHTML = `<div class="empty-state-card"><div class="empty-icon">🌟</div><h3 class="empty-title">No alumni records found</h3><p class="empty-sub">Try searching by graduation year, profession, or house name.</p></div>`;
    return;
  }

  grid.innerHTML = alumni.map(a => `
    <div class="entity-card">
      <div class="card-top-row">
        <div class="entity-avatar">${a.photo ? `<img src="${a.photo}" alt="${escapeHtml(a.name)}" class="entity-avatar-img">` : "🌟"}</div>
        <div class="entity-header-text">
          <h3 class="entity-name">${escapeHtml(a.name)}</h3>
          <div class="entity-meta-line">
            ${a.cadetNumber ? `<span>C.No ${escapeHtml(a.cadetNumber)}</span><span aria-hidden="true">·</span>` : ""}
            <span>Batch ${escapeHtml(a.batch)}</span>
            <span aria-hidden="true">·</span>
            <span>${escapeHtml(a.house)} House</span>
            <span aria-hidden="true">·</span>
            <span>Graduated ${escapeHtml(a.graduationYear)}</span>
          </div>
        </div>
      </div>
      <p class="entity-bio">${escapeHtml(a.biography)}</p>
      <div class="entity-badge-line">${escapeHtml(a.role)} · ${escapeHtml(a.organization)}</div>
      <div class="card-footer-row">
        <span class="status-verified">✓ Verified MECA Record</span>
        <div style="display:flex; gap:0.4rem; align-items:center;">
          <button type="button" class="btn-table-action primary" onclick="openEditRecordModal('alumni', '${a.id}')">✏️ Edit</button>
          <button type="button" class="card-action-btn view-person-btn" data-type="alumni" data-id="${a.id}">View Dossier</button>
        </div>
      </div>
    </div>
  `).join("");

  bindPersonModalButtons(grid);
}

// --- Achievements Grid ---
function renderAchievementsGrid(catFilter = "all", search = "") {
  const grid = document.getElementById("achievementsGrid");
  if (!grid) return;

  let items = DB.achievementData;
  if (catFilter !== "all") {
    items = items.filter(i => i.category.toLowerCase() === catFilter.toLowerCase());
  }
  if (search.trim()) {
    const q = search.toLowerCase();
    items = items.filter(i =>
      i.title.toLowerCase().includes(q) ||
      i.recipient.toLowerCase().includes(q) ||
      i.year.includes(q)
    );
  }

  if (!items.length) {
    grid.innerHTML = `<div class="empty-state-card"><div class="empty-icon">🏆</div><h3 class="empty-title">No achievements found</h3><p class="empty-sub">Adjust your category filter or search query.</p></div>`;
    return;
  }

  grid.innerHTML = items.map(ach => `
    <div class="entity-card">
      <div class="card-top-row">
        <div class="entity-avatar">🏆</div>
        <div class="entity-header-text">
          <h3 class="entity-name">${escapeHtml(ach.title)}</h3>
          <div class="entity-meta-line">
            <span>${escapeHtml(ach.category)}</span>
            <span aria-hidden="true">·</span>
            <span>Year ${escapeHtml(ach.year)}</span>
            <span aria-hidden="true">·</span>
            <span>Batch ${escapeHtml(ach.batch)}</span>
          </div>
        </div>
      </div>
      <p class="entity-bio">${escapeHtml(ach.desc)}</p>
      <div class="entity-badge-line">Conferred To: ${escapeHtml(ach.recipient)}</div>
      <div class="card-footer-row">
        <span class="status-verified">✓ Verified Laurels</span>
        <button type="button" class="card-action-btn" onclick="handleQuerySubmission('Tell me more about ${escapeHtml(ach.title)}')">Ask MCC AI</button>
      </div>
    </div>
  `).join("");
}

// --- Batches Explorer ---
function renderBatchesSection() {
  const strip = document.getElementById("batchSelectorStrip");
  if (!strip) return;

  const batches = [...new Set([
    ...DB.alumniData.map(person => person.batch),
    ...DB.cadetsData.map(person => person.batch),
    ...DB.achievementData.map(achievement => achievement.batch)
  ].filter(Boolean).map(String))].sort((a, b) => Number(a) - Number(b));
  strip.innerHTML = batches.map((batch, index) => `
    <button type="button" class="batch-selector-btn ${index === 0 ? "active" : ""}" data-batch="${escapeHtml(batch)}">Batch ${escapeHtml(batch)}</button>
  `).join("");

  strip.querySelectorAll(".batch-selector-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      strip.querySelectorAll(".batch-selector-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      renderBatchDetail(btn.getAttribute("data-batch"));
    });
  });

  if (batches.length) renderBatchDetail(batches[0]);
  else renderBatchDetail("");
}

function renderBatchDetail(batchNum) {
  const container = document.getElementById("batchDetailCard");
  if (!container) return;

  const alumni = DB.alumniData.filter(a => a.batch === String(batchNum));
  const cadets = DB.cadetsData.filter(c => c.batch === String(batchNum));
  const achs = DB.achievementData.filter(a => a.batch === String(batchNum));

  container.innerHTML = `
    <div class="batch-header-group">
      <span class="section-kicker">Cohort Dossier</span>
      <h3 class="batch-big-title">${batchNum ? `Batch ${escapeHtml(batchNum)}` : "Batch records"}</h3>
      ${batchNum ? `<p class="batch-sub-meta">Administrator-provided batch records</p>` : ""}
    </div>
    <div class="batch-columns-layout">
      <div>
        <h4 class="batch-col-title"><span>👥</span> Cadets & Alumni Records</h4>
        ${(alumni.length || cadets.length) ? `
          <ul class="cadet-roster-list">
            ${alumni.map(a => `
              <li class="cadet-roster-item">
                <div>
                  <strong>${escapeHtml(a.name)}</strong>
                  <div style="font-size:0.75rem; color:var(--text-muted);">${a.role} · ${a.organization}</div>
                </div>
                <button type="button" class="btn-text-sm view-person-btn" data-type="alumni" data-id="${a.id}">Profile</button>
              </li>
            `).join("")}
            ${cadets.map(c => `
              <li class="cadet-roster-item">
                <div>
                  <strong>${escapeHtml(c.name)}</strong>
                  <div style="font-size:0.75rem; color:var(--text-muted);">C.No ${c.cadetNumber} · ${c.house} House</div>
                </div>
                <button type="button" class="btn-text-sm view-person-btn" data-type="cadet" data-id="${c.id}">Profile</button>
              </li>
            `).join("")}
          </ul>
        ` : `<p style="font-size:0.85rem; color:var(--text-muted);">${batchNum ? `No records currently indexed for Batch ${escapeHtml(batchNum)}.` : "No batch records have been added by an administrator yet."}</p>`}
      </div>
      <div>
        <h4 class="batch-col-title"><span>🏆</span> Recorded Batch Achievements</h4>
        ${achs.length ? `
          <ul class="cadet-roster-list">
            ${achs.map(ach => `
              <li class="cadet-roster-item">
                <div>
                  <strong>${escapeHtml(ach.title)}</strong>
                  <div style="font-size:0.75rem; color:var(--text-muted);">${ach.recipient} (${ach.year})</div>
                </div>
                <span class="status-verified">✓</span>
              </li>
            `).join("")}
          </ul>
        ` : `
          <p style="font-size:0.85rem; color:var(--text-muted);">No achievement records have been added for this batch.</p>
        `}
      </div>
    </div>
  `;

  bindPersonModalButtons(container);
}

// --- Houses Grid ---
function renderHousesGrid() {
  const grid = document.getElementById("housesGrid");
  if (!grid) return;

  grid.innerHTML = DB.houseData.map(h => {
    let cssClass = "house-fazlul";
    if (h.id.includes("suhrawardy")) cssClass = "house-suhrawardy";
    else if (h.id.includes("nazrul")) cssClass = "house-nazrul";

    return `
      <div class="house-card">
        <div class="house-crest-banner ${cssClass}">
          <span>${h.name}</span>
          <span style="font-family:var(--font-mono); font-size:0.8rem;">${h.color.toUpperCase()} HOUSE</span>
        </div>
        <div class="house-card-body">
          <p class="house-motto-quote">"${h.motto}"</p>
          <p style="font-size:0.88rem; color:var(--text-secondary); margin-bottom:1rem; line-height:1.55;">${h.overview}</p>
          <div class="house-stats-row">
            <div>
              <span style="display:block; font-size:0.7rem; color:var(--text-muted);">House Master</span>
              <strong>${h.houseMaster}</strong>
            </div>
            <div>
              <span style="display:block; font-size:0.7rem; color:var(--text-muted);">Cadet Captain</span>
              <strong>${h.cadetCaptain}</strong>
            </div>
          </div>
          <div style="margin-top:0.75rem; font-size:0.8rem; color:var(--color-gold-bright);">
            🏆 Champion Trophies Won: <strong>${h.trophies}</strong>
          </div>
        </div>
      </div>
    `;
  }).join("");
}

// --- Events List ---
function renderEventsList() {
  const container = document.getElementById("eventsList");
  if (!container) return;

  container.innerHTML = DB.eventData.map(evt => `
    <div class="event-row-card">
      <div class="event-date-block">
        <span class="event-date-day">${evt.displayDate.day}</span>
        <span class="event-date-month">${evt.displayDate.month}</span>
      </div>
      <div class="event-details-block">
        <h3>${escapeHtml(evt.name)}</h3>
        <div class="event-meta-unboxed">
          <span>${escapeHtml(evt.category)}</span> · <span>📍 ${escapeHtml(evt.location)}</span> · <span>Participants: ${escapeHtml(evt.participants)}</span>
        </div>
        <p class="event-desc-text">${escapeHtml(evt.description)}</p>
      </div>
      <div>
        <button type="button" class="btn-institutional-secondary" onclick="handleQuerySubmission('Tell me about the ${escapeHtml(evt.name)}')">Ask AI</button>
      </div>
    </div>
  `).join("");
}

// --- Global Search ---
function executeGlobalSearch() {
  const query = (document.getElementById("globalSearchInput")?.value || "").trim().toLowerCase();
  const countEl = document.getElementById("searchResultCount");
  const grid = document.getElementById("searchResultsGrid");
  if (!grid) return;

  const chkAlumni = document.getElementById("chkSearchAlumni")?.checked ?? true;
  const chkCadets = document.getElementById("chkSearchCadets")?.checked ?? true;
  const chkAdmin = document.getElementById("chkSearchAdmin")?.checked ?? true;
  const chkAch = document.getElementById("chkSearchAchievements")?.checked ?? true;
  const chkHouses = document.getElementById("chkSearchHouses")?.checked ?? true;
  const chkCollege = document.getElementById("chkSearchCollege")?.checked ?? true;

  if (!query) {
    if (countEl) countEl.textContent = "Enter a keyword to search administrator-provided records.";
    grid.innerHTML = `<div class="empty-state-card"><div class="empty-icon">🔍</div><h3 class="empty-title">Knowledge Search Engine Ready</h3><p class="empty-sub">Type a name, batch number, house, subject, or accomplishment to explore.</p></div>`;
    return;
  }

  const results = [];

  if (chkAlumni) {
    DB.alumniData.forEach(a => {
      if (a.name.toLowerCase().includes(query) || (a.cadetNumber && a.cadetNumber.includes(query)) || a.batch.includes(query) || a.house.toLowerCase().includes(query) || (a.role && a.role.toLowerCase().includes(query))) {
        results.push({
          type: "Alumni / Ex-Cadet",
          title: a.name,
          sub: `${a.cadetNumber ? `C.No ${a.cadetNumber} · ` : ""}Batch ${a.batch} · ${a.house} House · ${a.role}`,
          desc: a.biography,
          verified: a.verified,
          photo: a.photo,
          id: a.id,
          rawType: "alumni"
        });
      }
    });
  }

  if (chkCadets) {
    DB.cadetsData.forEach(c => {
      if (c.name.toLowerCase().includes(query) || c.cadetNumber.includes(query) || c.house.toLowerCase().includes(query) || c.batch.includes(query)) {
        results.push({
          type: "Current Cadet",
          title: c.name,
          sub: `C.No ${c.cadetNumber} · Batch ${c.batch} · ${c.house} House`,
          desc: c.biography,
          verified: c.verified,
          photo: c.photo,
          id: c.id,
          rawType: "cadet"
        });
      }
    });
  }

  if (chkAdmin) {
    DB.administrationData.forEach(adm => {
      if (adm.name.toLowerCase().includes(query) || adm.position.toLowerCase().includes(query) || adm.department.toLowerCase().includes(query)) {
        results.push({
          type: "Administration",
          title: adm.name,
          sub: `${adm.position} · ${adm.department}`,
          desc: adm.biography,
          verified: adm.verified,
          photo: adm.photo,
          id: adm.id,
          rawType: "admin"
        });
      }
    });
  }

  if (chkAch) {
    DB.achievementData.forEach(ach => {
      if (ach.title.toLowerCase().includes(query) || ach.recipient.toLowerCase().includes(query) || ach.desc.toLowerCase().includes(query)) {
        results.push({
          type: "Achievement Record",
          title: ach.title,
          sub: `${ach.category} · Year ${ach.year} · Recipient: ${ach.recipient}`,
          desc: ach.desc,
          verified: ach.verified,
          id: ach.id,
          rawType: "achievement"
        });
      }
    });
  }

  if (chkHouses) {
    DB.houseData.forEach(h => {
      if (h.name.toLowerCase().includes(query) || h.color.toLowerCase().includes(query) || h.overview.toLowerCase().includes(query)) {
        results.push({
          type: "House",
          title: h.name,
          sub: `${h.color} House · Motto: "${h.motto}"`,
          desc: h.overview,
          verified: true,
          id: h.id,
          rawType: "house"
        });
      }
    });
  }

  if (chkCollege) {
    if (DB.collegeData.history.content.toLowerCase().includes(query)) {
      results.push({
        type: "College History",
        title: "Institution History",
        sub: "Administrator-provided information",
        desc: DB.collegeData.history.content,
        verified: true,
        id: "history",
        rawType: "college"
      });
    }
  }

  if (countEl) countEl.textContent = `Found ${results.length} verified records matching "${query}".`;

  if (!results.length) {
    grid.innerHTML = `<div class="empty-state-card"><div class="empty-icon">🔎</div><h3 class="empty-title">No records matching "${escapeHtml(query)}"</h3><p class="empty-sub">Check spelling or ask an administrator to add this record in the Admin Portal.</p></div>`;
    return;
  }

  grid.innerHTML = results.map(r => `
    <div class="entity-card">
      <div class="card-top-row">
        <div class="entity-avatar">${r.photo ? `<img src="${r.photo}" alt="${escapeHtml(r.title)}" class="entity-avatar-img">` : (r.rawType === "alumni" ? "🌟" : r.rawType === "cadet" ? "👤" : r.rawType === "achievement" ? "🏆" : "🏛️")}</div>
        <div class="entity-header-text">
          <h3 class="entity-name">${escapeHtml(r.title)}</h3>
          <div class="entity-meta-line">
            <span>${escapeHtml(r.type)}</span>
            <span aria-hidden="true">·</span>
            <span>${escapeHtml(r.sub)}</span>
          </div>
        </div>
      </div>
      <p class="entity-bio">${escapeHtml(r.desc)}</p>
      <div class="card-footer-row">
        <span class="status-verified">${r.verified ? "✓ Verified" : "○ Unverified"}</span>
        <button type="button" class="card-action-btn view-person-btn" data-type="${r.rawType}" data-id="${r.id}">Inspect Record</button>
      </div>
    </div>
  `).join("");

  bindPersonModalButtons(grid);
}

// ============================================================================
// 9. PROFILE MODAL COMPONENT (Universal Person Dossier)
// ============================================================================

function openProfileModal(type, id) {
  let person = null;
  if (type === "alumni") person = DB.alumniData.find(a => a.id === id);
  else if (type === "cadet") person = DB.cadetsData.find(c => c.id === id);
  else if (type === "admin" || type === "administration") person = DB.administrationData.find(adm => adm.id === id);
  else if (type === "achievement") {
    const ach = (DB.achievementData || []).find(a => a.id === id);
    if (ach) {
      person = {
        name: ach.title,
        photo: "",
        privacy: "PUBLIC",
        role: ach.category,
        organization: ach.recipient,
        position: ach.category,
        department: ach.recipient,
        officialContact: "",
        status: "",
        biography: ach.desc,
        achievements: [ach.title],
        lastUpdated: ach.year
      };
    }
  }

  if (!person) return;

  const modal = document.getElementById("profileModal");
  const body = document.getElementById("profileModalBody");

  const avatar = type === "alumni" ? "🌟" : type === "cadet" ? "👤" : "🎖️";
  const avatarContent = person.photo 
    ? `<img src="${person.photo}" alt="${escapeHtml(person.name)}" class="profile-avatar-img">`
    : avatar;
  const privacy = person.privacy || "PUBLIC";

  let dlHtml = "";
  if (type === "alumni") {
    dlHtml = `
      <dl class="profile-meta-dl">
        <div><dt>Cadet Number:</dt><dd>${person.cadetNumber ? `<strong>C.No ${escapeHtml(person.cadetNumber)}</strong>` : ""}</dd></div>
        <div><dt>Batch Number:</dt><dd>Batch ${person.batch}</dd></div>
        <div><dt>House Affiliation:</dt><dd>${person.house} House</dd></div>
        <div><dt>Graduation Year:</dt><dd>${person.graduationYear}</dd></div>
        <div><dt>Profession:</dt><dd>${person.profession}</dd></div>
        <div><dt>Designation:</dt><dd>${person.role || "-"}</dd></div>
        <div><dt>Organization:</dt><dd>${person.organization || "-"}</dd></div>
      </dl>
    `;
  } else if (type === "cadet") {
    dlHtml = `
      <dl class="profile-meta-dl">
        <div><dt>Cadet Number:</dt><dd><strong>C.No ${escapeHtml(person.cadetNumber)}</strong></dd></div>
        <div><dt>Batch:</dt><dd>Batch ${person.batch}</dd></div>
        <div><dt>House:</dt><dd>${person.house} House</dd></div>
        ${person.status ? `<div><dt>Status:</dt><dd>${escapeHtml(person.status)}</dd></div>` : ""}
      </dl>
    `;
  } else {
    dlHtml = `
      <dl class="profile-meta-dl">
        <div><dt>Official Position:</dt><dd>${person.position}</dd></div>
        <div><dt>Department:</dt><dd>${person.department}</dd></div>
        <div><dt>Official Contact:</dt><dd>${person.officialContact}</dd></div>
        <div><dt>Status:</dt><dd>${person.status}</dd></div>
      </dl>
    `;
  }

  body.innerHTML = `
    <div class="profile-modal-top">
      <div class="profile-modal-avatar">${avatarContent}</div>
      <div>
        <h2 class="profile-modal-name" id="modalProfileName">${escapeHtml(person.name)}</h2>
        <div style="font-size:0.8rem; color:var(--text-muted); margin-top:0.35rem;">
          <span>${person.verified ? "✓ Verified" : "⚠ Pending"}</span> ·
          <span>Privacy Tier: ${privacy}</span> ·
          <span>Updated: ${person.lastUpdated || ""}</span>
        </div>
      </div>
    </div>

    ${dlHtml}

    <h4 class="profile-section-title">Institutional Biography</h4>
    <p class="profile-modal-bio">${escapeHtml(person.biography)}</p>

    ${person.achievements && person.achievements.length ? `
      <h4 class="profile-section-title">Verified Honors & Laurels</h4>
      <ul style="padding-left:1.25rem; font-size:0.88rem; color:var(--text-secondary); line-height:1.6; margin-bottom:1rem;">
        ${person.achievements.map(ach => `<li>${escapeHtml(ach)}</li>`).join("")}
      </ul>
    ` : ""}

    ${person.education && person.education.length ? `
      <h4 class="profile-section-title">Higher Education</h4>
      <ul style="padding-left:1.25rem; font-size:0.88rem; color:var(--text-secondary); line-height:1.6; margin-bottom:1rem;">
        ${person.education.map(e => `<li>${escapeHtml(e)}</li>`).join("")}
      </ul>
    ` : ""}

    <div style="display:flex; justify-content:space-between; align-items:center; margin-top:1.5rem; padding-top:1rem; border-top:1px solid var(--border-subtle); flex-wrap:wrap; gap:0.6rem;">
      <div style="display:flex; gap:0.45rem; flex-wrap:wrap; align-items:center;">
        <button type="button" class="btn-table-action primary" onclick="openEditRecordModal('${type}', '${person.id}')">✏️ Edit Information</button>
        <button type="button" class="btn-table-action" onclick="openVersionHistoryModal('${person.id}', '${escapeHtml(person.name)}')">📜 Version History</button>
        <button type="button" class="btn-table-action danger" onclick="deleteRecordAction('${type}', '${person.id}')">🗑️ Delete</button>
      </div>
      <button type="button" class="btn-institutional-primary" onclick="closeProfileModal(); handleQuerySubmission('Tell me about ${escapeHtml(person.name)}')">Ask MCC AI About Person</button>
    </div>
  `;

  modal.removeAttribute("hidden");
  modal.classList.remove("is-hidden");
  modal.style.removeProperty("display");
  modal.style.display = "flex";
}

function closeProfileModal() {
  const modal = document.getElementById("profileModal");
  if (modal) {
    modal.setAttribute("hidden", "true");
    modal.classList.add("is-hidden");
    modal.style.display = "none";
  }
}

function bindPersonModalButtons(parent) {
  parent.querySelectorAll(".view-person-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const type = btn.getAttribute("data-type");
      const id = btn.getAttribute("data-id");
      openProfileModal(type, id);
    });
  });
}

// ============================================================================
// 10. VERSION HISTORY MODAL (View Record Audit Log & Changelog)
// ============================================================================

function openVersionHistoryModal(recordId, recordName) {
  const modal = document.getElementById("versionModal");
  if (!modal) return;
  const targetLabel = document.getElementById("versionTargetName");
  const timeline = document.getElementById("versionTimeline");

  if (targetLabel) targetLabel.textContent = `Record Audit Log: ${recordName || "Official Entity"}`;

  const history = (DB.versionHistory && DB.versionHistory[recordId]) || [];

  if (timeline) {
    timeline.innerHTML = history.length ? history.map(v => `
      <div class="version-timeline-item">
        <div class="version-timeline-header">
          <span class="version-pill">Version ${v.version}</span>
          <span class="version-timestamp">${v.updatedAt} by ${escapeHtml(v.updatedBy || "Admin")}</span>
        </div>
        <p class="version-notes">${escapeHtml(v.notes)}</p>
      </div>
    `).join("") : `<p class="empty-state">No version history is available for this record.</p>`;
  }

  modal.removeAttribute("hidden");
  modal.classList.remove("is-hidden");
  modal.style.removeProperty("display");
  modal.style.display = "flex";
}

function closeVersionHistoryModal() {
  const modal = document.getElementById("versionModal");
  if (modal) {
    modal.setAttribute("hidden", "true");
    modal.classList.add("is-hidden");
    modal.style.display = "none";
  }
}

// ============================================================================
// 10B. RECORD EDITOR MODAL & PHOTO UPLOAD MANAGEMENT (Edit Cadet No, Photo, Info)
// ============================================================================

function setPhotoPreviewState(prefix, photoSrc) {
  const preview = document.getElementById(`${prefix}PhotoPreview`);
  const empty = document.getElementById(`${prefix}PhotoEmpty`);
  const removeBtn = document.getElementById(`${prefix}RemovePhotoBtn`);
  const dataInput = document.getElementById(`${prefix}PhotoData`);
  const urlInput = document.getElementById(`${prefix}PhotoUrl`);
  const fileInput = document.getElementById(`${prefix}PhotoFile`);

  if (!preview || !empty || !dataInput) return;

  if (photoSrc) {
    preview.src = photoSrc;
    preview.style.display = "block";
    empty.style.display = "none";
    if (removeBtn) removeBtn.style.display = "inline-block";
    dataInput.value = photoSrc;
    if (urlInput) urlInput.value = photoSrc.startsWith("data:") ? "" : photoSrc;
  } else {
    preview.src = "";
    preview.style.display = "none";
    empty.style.display = "flex";
    if (removeBtn) removeBtn.style.display = "none";
    dataInput.value = "";
    if (urlInput) urlInput.value = "";
    if (fileInput) fileInput.value = "";
  }
}

function setupPhotoInputHandlers(prefix) {
  const urlInput = document.getElementById(`${prefix}PhotoUrl`);
  const fileInput = document.getElementById(`${prefix}PhotoFile`);
  const removeBtn = document.getElementById(`${prefix}RemovePhotoBtn`);

  if (urlInput) {
    urlInput.addEventListener("input", (e) => {
      const val = e.target.value.trim();
      if (val) {
        setPhotoPreviewState(prefix, val);
      } else {
        const fileInp = document.getElementById(`${prefix}PhotoFile`);
        if (!fileInp || !fileInp.files || !fileInp.files.length) {
          setPhotoPreviewState(prefix, "");
        }
      }
    });
  }

  if (fileInput) {
    fileInput.addEventListener("change", (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = function(evt) {
        const rawData = evt.target.result;
        const img = new Image();
        img.onload = function() {
          const canvas = document.createElement("canvas");
          let w = img.width;
          let h = img.height;
          const maxDim = 400; // Optimal 400x400 max dimension for fast LocalStorage persistence
          if (w > maxDim || h > maxDim) {
            if (w > h) {
              h = Math.round((h * maxDim) / w);
              w = maxDim;
            } else {
              w = Math.round((w * maxDim) / h);
              h = maxDim;
            }
          }
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, w, h);
          const compressed = canvas.toDataURL("image/jpeg", 0.85);
          setPhotoPreviewState(prefix, compressed);
        };
        img.onerror = function() {
          setPhotoPreviewState(prefix, rawData);
        };
        img.src = rawData;
      };
      reader.readAsDataURL(file);
    });
  }

  if (removeBtn) {
    removeBtn.addEventListener("click", () => {
      setPhotoPreviewState(prefix, "");
    });
  }
}

function openEditRecordModal(type, id) {
  let person = null;
  if (type === "alumni") person = DB.alumniData.find(a => a.id === id);
  else if (type === "cadet") person = DB.cadetsData.find(c => c.id === id);
  else if (type === "admin" || type === "administration") person = DB.administrationData.find(a => a.id === id);

  if (!person) {
    showToast("Record not found.", "danger");
    return;
  }

  const modal = document.getElementById("editRecordModal");
  if (!modal) return;

  document.getElementById("editRecordId").value = person.id;
  document.getElementById("editRecordType").value = type;
  document.getElementById("editModalTitle").textContent = `Edit Record: ${person.name}`;
  document.getElementById("editModalSub").textContent = `Update details for ${person.name} (${type.toUpperCase()}). Every change logs a new version.`;

  document.getElementById("editFullName").value = person.name || "";
  document.getElementById("editRoleProf").value = person.role || person.profession || person.position || "";
  document.getElementById("editOrganization").value = person.organization || person.department || "";
  document.getElementById("editStatus").value = person.verified ? "true" : "false";
  document.getElementById("editKeywords").value = (person.keywords || []).join(", ");

  // Handle Cadet Number, Class, Batch, House, and Privacy
  const cadetRow = document.getElementById("editCadetRow");
  const houseRow = document.getElementById("editHouseRow");
  if (type === "admin" || type === "administration") {
    if (cadetRow) cadetRow.style.display = "none";
    if (houseRow) houseRow.style.display = "none";
  } else {
    if (cadetRow) cadetRow.style.display = "grid";
    if (houseRow) houseRow.style.display = "grid";
    const editCadetNum = document.getElementById("editCadetNumber");
    if (editCadetNum) editCadetNum.value = person.cadetNumber || "";
    const editClass = document.getElementById("editClass");
    if (editClass) editClass.value = person.className || "";
    const editBatch = document.getElementById("editBatch");
    if (editBatch) editBatch.value = person.batch || "";
    const editHouse = document.getElementById("editHouse");
    if (editHouse) {
      editHouse.value = person.house || "";
    }
    const editPrivacy = document.getElementById("editPrivacy");
    if (editPrivacy) editPrivacy.value = person.privacy || "PUBLIC";
  }

  // Populate person photograph (direct link or local storage base64)
  setPhotoPreviewState("edit", person.photo || "");

  document.getElementById("editAchievements").value = (person.achievements || []).join(", ");
  document.getElementById("editBio").value = person.biography || "";

  // Wire delete button for this person
  const delBtn = document.getElementById("deleteInEditBtn");
  if (delBtn) {
    delBtn.onclick = () => deleteRecordAction(type, id);
  }

  modal.removeAttribute("hidden");
  modal.classList.remove("is-hidden");
  modal.style.removeProperty("display");
  modal.style.display = "flex";
}

function closeEditRecordModal() {
  const modal = document.getElementById("editRecordModal");
  if (modal) {
    modal.setAttribute("hidden", "true");
    modal.classList.add("is-hidden");
    modal.style.display = "none";
  }
}

function handleEditRecordSubmit(e) {
  if (e) e.preventDefault();

  const id = document.getElementById("editRecordId").value;
  const type = document.getElementById("editRecordType").value;
  const name = document.getElementById("editFullName").value.trim();
  const roleProf = document.getElementById("editRoleProf").value.trim();
  const org = document.getElementById("editOrganization").value.trim();
  const verified = document.getElementById("editStatus").value === "true";
  const cadetNumber = document.getElementById("editCadetNumber") ? document.getElementById("editCadetNumber").value.trim() : "";
  const className = document.getElementById("editClass") ? document.getElementById("editClass").value : "";
  const batch = document.getElementById("editBatch") ? document.getElementById("editBatch").value.trim() : "";
  const house = document.getElementById("editHouse") ? document.getElementById("editHouse").value : "";
  const privacy = document.getElementById("editPrivacy") ? document.getElementById("editPrivacy").value : "PUBLIC";
  const photo = document.getElementById("editPhotoData") ? document.getElementById("editPhotoData").value.trim() : "";
  const achRaw = document.getElementById("editAchievements").value.trim();
  const keywordRaw = document.getElementById("editKeywords") ? document.getElementById("editKeywords").value.trim() : "";
  const bio = document.getElementById("editBio").value.trim();
  const changeNote = "Updated information";

  if (!name) {
    showToast("Full Name is required.", "danger");
    return;
  }

  let person = null;
  if (type === "alumni") person = DB.alumniData.find(a => a.id === id);
  else if (type === "cadet") person = DB.cadetsData.find(c => c.id === id);
  else if (type === "admin" || type === "administration") person = DB.administrationData.find(a => a.id === id);

  if (!person) {
    showToast("Record not found to update.", "danger");
    return;
  }

  const today = new Date().toISOString().split("T")[0];

  // Update properties
  person.name = name;
  person.photo = photo; // direct URL or local storage base64
  if (type === "alumni") {
    person.cadetNumber = cadetNumber;
    person.role = roleProf;
    person.profession = roleProf;
    person.organization = org;
    if (batch) person.batch = batch;
    person.house = house;
    person.privacy = privacy;
  } else if (type === "cadet") {
    if (type === "cadet" && !className) {
      showToast("Select the current class before saving this student record.", "danger");
      return;
    }
    person.cadetNumber = cadetNumber || person.cadetNumber || "";
    person.className = className || person.className || "";
    if (batch) person.batch = batch;
    person.house = house;
    person.privacy = privacy;
  } else {
    person.position = roleProf;
    person.department = org;
  }

  person.verified = verified;
  person.biography = bio;
  person.achievements = achRaw ? achRaw.split(",").map(s => s.trim()).filter(Boolean) : [];
  person.keywords = parseKeywords(keywordRaw);
  person.lastUpdated = today;

  // Record Version History
  if (!DB.versionHistory) DB.versionHistory = {};
  if (!DB.versionHistory[id]) {
    DB.versionHistory[id] = [
      { version: 1, updatedAt: today, updatedBy: "Admin", notes: "Record created by administrator." }
    ];
  }
  const nextVer = DB.versionHistory[id].length + 1;
  DB.versionHistory[id].unshift({
    version: nextVer,
    updatedAt: today,
    updatedBy: "Admin",
    notes: changeNote
  });

  // Log Audit Action
  logAuditAction("Admin", "UPDATE_RECORD", `${person.name} (${type.toUpperCase()})`, `v${nextVer}: ${changeNote}${cadetNumber ? ` [C.No: ${cadetNumber}]` : ""}${photo ? " [Photo Updated]" : ""}`);

  // Save to persistent storage
  StorageManager.saveData(DB);

  // Refresh Views
  refreshAdminStats();
  renderPendingQueue();
  renderAdminDataTable();
  renderAuditLogTable();
  renderAlumniGrid();
  renderCadetsGrid();
  renderAdministrationGrid();

  // If person profile modal is currently open, refresh its content
  const profileModal = document.getElementById("profileModal");
  if (profileModal && !profileModal.hidden && profileModal.style.display !== "none") {
    openProfileModal(type, id);
  }

  closeEditRecordModal();
  showToast(`Updated information for "${person.name}" saved as Version ${nextVer}.`, "success");
}

// ============================================================================
// INSTITUTIONAL DIALOG & NOTIFICATION SYSTEM (Iframe-safe, non-blocking)
// ============================================================================

function showConfirmDialog({ title = "Confirm Action", message = "Are you sure you wish to proceed?", confirmText = "Confirm", cancelText = "Cancel", isDanger = true }) {
  return new Promise((resolve) => {
    const modal = document.getElementById("appConfirmModal");
    if (!modal) {
      resolve(true);
      return;
    }
    const titleEl = document.getElementById("confirmModalTitle");
    const msgEl = document.getElementById("confirmModalMessage");
    const confirmBtn = document.getElementById("confirmModalConfirmBtn");
    const cancelBtn = document.getElementById("confirmModalCancelBtn");
    const closeBtn = document.getElementById("confirmModalCloseBtn");

    if (titleEl) titleEl.textContent = title;
    if (msgEl) msgEl.textContent = message;
    if (confirmBtn) {
      confirmBtn.textContent = confirmText;
      confirmBtn.className = isDanger ? "btn-institutional-primary danger" : "btn-institutional-primary";
    }
    if (cancelBtn) cancelBtn.textContent = cancelText;

    const cleanup = (result) => {
      modal.setAttribute("hidden", "true");
      modal.style.setProperty("display", "none", "important");
      if (confirmBtn) confirmBtn.onclick = null;
      if (cancelBtn) cancelBtn.onclick = null;
      if (closeBtn) closeBtn.onclick = null;
      resolve(result);
    };

    if (confirmBtn) confirmBtn.onclick = () => cleanup(true);
    if (cancelBtn) cancelBtn.onclick = () => cleanup(false);
    if (closeBtn) closeBtn.onclick = () => cleanup(false);

    modal.removeAttribute("hidden");
    modal.style.display = "flex";
  });
}

function showToast(message, type = "success") {
  let container = document.getElementById("toastContainer");
  if (!container) {
    container = document.createElement("div");
    container.id = "toastContainer";
    container.className = "toast-container";
    document.body.appendChild(container);
  }
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  const icon = type === "success" ? "✓" : type === "danger" ? "✕" : "ℹ";
  toast.innerHTML = `
    <span class="toast-icon">${icon}</span>
    <span class="toast-text">${escapeHtml(message)}</span>
    <button type="button" class="toast-close" aria-label="Dismiss">✕</button>
  `;
  const closeBtn = toast.querySelector(".toast-close");
  if (closeBtn) {
    closeBtn.onclick = () => toast.remove();
  }
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add("toast-fade-out");
    setTimeout(() => toast.remove(), 260);
  }, 3200);
}

// Window alert shim to ensure alerts are displayed cleanly in sandboxed iframes
window.alert = function(msg) {
  showToast(String(msg), "info");
};

async function deleteRecordAction(type, id) {
  let person = null;
  if (type === "alumni") person = DB.alumniData.find(a => a.id === id);
  else if (type === "cadet") person = DB.cadetsData.find(c => c.id === id);
  else if (type === "admin" || type === "administration") person = DB.administrationData.find(a => a.id === id);
  else if (type === "achievement") {
    const ach = (DB.achievementData || []).find(a => a.id === id);
    if (ach) person = { name: ach.title };
  }

  if (!person) {
    showToast("Record not found.", "danger");
    return;
  }

  const confirmed = await showConfirmDialog({
    title: "Delete Record",
    message: `Are you sure you want to permanently delete the record for "${person.name}" (${type.toUpperCase()})? This action will be recorded in the audit trail.`,
    confirmText: "Delete Record",
    isDanger: true
  });

  if (!confirmed) return;

  if (type === "alumni") {
    DB.alumniData = DB.alumniData.filter(a => a.id !== id);
  } else if (type === "cadet") {
    DB.cadetsData = DB.cadetsData.filter(c => c.id !== id);
  } else if (type === "achievement") {
    DB.achievementData = (DB.achievementData || []).filter(a => a.id !== id);
    renderAchievementsGrid();
  } else {
    DB.administrationData = DB.administrationData.filter(a => a.id !== id);
  }

  logAuditAction("Admin", "DELETE_RECORD", `${person.name} (${type.toUpperCase()})`, "Record permanently removed by administrator.");
  StorageManager.saveData(DB);

  refreshAdminStats();
  renderPendingQueue();
  renderAdminDataTable();
  renderAuditLogTable();
  renderAlumniGrid();
  renderCadetsGrid();
  renderAdministrationGrid();

  closeEditRecordModal();
  closeProfileModal();

  showToast(`Record for "${person.name}" has been permanently deleted.`, "success");
}

// ============================================================================
// 11. ADMIN DASHBOARD & AUTHENTICATION
// ============================================================================

let isAdminAuthenticated = sessionStorage.getItem("mcc_admin_session") === "true";

function checkAdminSession() {
  const gate = document.getElementById("adminLoginGate");
  const panel = document.getElementById("adminDashboardPanel");

  if (isAdminAuthenticated) {
    gate.setAttribute("hidden", "true");
    panel.removeAttribute("hidden");
    refreshAdminStats();
    renderQaCards();
    renderPendingQueue();
    renderAdminDataTable();
    renderAuditLogTable();
  } else {
    gate.removeAttribute("hidden");
    panel.setAttribute("hidden", "true");
  }
}

function refreshAdminStats() {
  const cadetsCount = DB.cadetsData ? DB.cadetsData.length : 0;
  const alumniCount = DB.alumniData ? DB.alumniData.length : 0;
  const adminCount = DB.administrationData ? DB.administrationData.length : 0;
  const achCount = DB.achievementData ? DB.achievementData.length : 0;
  const totalCount = cadetsCount + alumniCount + adminCount + achCount;

  const pendingAlumni = DB.alumniData ? DB.alumniData.filter(a => !a.verified).length : 0;
  const pendingCadets = DB.cadetsData ? DB.cadetsData.filter(c => !c.verified).length : 0;
  const pendingTotal = pendingAlumni + pendingCadets;

  const verifiedTotal = totalCount - pendingTotal;
  const qaCount = DB.sampleQuestions ? DB.sampleQuestions.length : 0;
  const auditCount = DB.auditLog ? DB.auditLog.length : 0;

  const statCadets = document.getElementById("statCadets");
  if (statCadets) statCadets.textContent = cadetsCount;

  const statAlumni = document.getElementById("statAlumni");
  if (statAlumni) statAlumni.textContent = alumniCount;

  const statAdmin = document.getElementById("statAdmin");
  if (statAdmin) statAdmin.textContent = adminCount;

  const statPending = document.getElementById("statPending");
  if (statPending) statPending.textContent = pendingTotal;

  const statVerified = document.getElementById("statVerified");
  if (statVerified) statVerified.textContent = verifiedTotal;

  const peopleBadge = document.getElementById("peopleCountBadge");
  if (peopleBadge) peopleBadge.textContent = totalCount;

  const totalRecEl = document.getElementById("totalRecordsCount");
  if (totalRecEl) totalRecEl.textContent = totalCount;

  const pendingBadge = document.getElementById("pendingCountBadge");
  if (pendingBadge) pendingBadge.textContent = pendingTotal;

  const qaBadge = document.getElementById("qaCountBadge");
  if (qaBadge) qaBadge.textContent = qaCount;

  const auditBadge = document.getElementById("auditCountBadge");
  if (auditBadge) auditBadge.textContent = auditCount;
}

function renderPendingQueue() {
  const container = document.getElementById("pendingItemsList");
  if (!container) return;

  const pendingItems = [
    ...(DB.alumniData || []).filter(a => !a.verified).map(x => ({ ...x, recordType: "alumni" })),
    ...(DB.cadetsData || []).filter(c => !c.verified).map(x => ({ ...x, recordType: "cadet" }))
  ];

  if (!pendingItems.length) {
    container.innerHTML = `<div class="empty-state-card"><div class="empty-icon">✓</div><h3 class="empty-title">All Records Verified</h3><p class="empty-sub">There are currently no items awaiting administrative verification.</p></div>`;
    return;
  }

  container.innerHTML = pendingItems.map(item => `
    <div class="pending-card">
      <div class="pending-meta">
        <h4 class="pending-title">${escapeHtml(item.name)}</h4>
        <div class="pending-info">
          Type: ${item.recordType.toUpperCase()} · Batch: ${item.batch} · Updated: ${item.lastUpdated || "Recent"}
        </div>
        <p style="font-size:0.85rem; color:var(--text-secondary); margin-top:0.35rem;">${escapeHtml(item.biography || "No biography provided")}</p>
      </div>
      <div class="pending-actions">
        <button type="button" class="btn-verify" onclick="verifyRecordAction('${item.recordType}', '${item.id}')">✓ Verify</button>
        <button type="button" class="btn-reject" onclick="rejectRecordAction('${item.recordType}', '${item.id}')">✕ Reject</button>
      </div>
    </div>
  `).join("");
}

function verifyRecordAction(type, id) {
  let target = null;
  if (type === "alumni") target = DB.alumniData.find(a => a.id === id);
  else if (type === "cadet") target = DB.cadetsData.find(c => c.id === id);

  if (target) {
    target.verified = true;
    target.lastUpdated = new Date().toISOString().split("T")[0];
    StorageManager.saveData(DB);
    logAuditAction("Admin", "VERIFY_RECORD", `${target.name} (${type.toUpperCase()})`, "Status changed to Verified.");
    refreshAdminStats();
    renderPendingQueue();
    renderAdminDataTable();
    renderAuditLogTable();
    showToast(`Record for "${target.name}" has been successfully verified!`, "success");
  }
}

async function rejectRecordAction(type, id) {
  const confirmed = await showConfirmDialog({
    title: "Reject Pending Record",
    message: "Are you sure you want to reject and remove this pending record from the queue?",
    confirmText: "Reject & Remove",
    isDanger: true
  });

  if (!confirmed) return;

  if (type === "alumni") DB.alumniData = DB.alumniData.filter(a => a.id !== id);
  else if (type === "cadet") DB.cadetsData = DB.cadetsData.filter(c => c.id !== id);

  StorageManager.saveData(DB);
  logAuditAction("Admin", "REJECT_RECORD", `${id} (${type})`, "Pending update rejected by administrator.");
  refreshAdminStats();
  renderPendingQueue();
  renderAdminDataTable();
  renderAuditLogTable();
  showToast("Pending record has been rejected and removed.", "info");
}

function renderAdminDataTable(filterQuery = "", typeFilter = "ALL") {
  const tbody = document.getElementById("adminRecordsTbody");
  if (!tbody) return;

  const q = (filterQuery || "").toLowerCase().trim();
  const tFilter = typeFilter || (document.getElementById("adminRecordsTypeFilter") ? document.getElementById("adminRecordsTypeFilter").value : "ALL");

  const allRecords = [
    ...(DB.alumniData || []).map(a => ({
      id: a.id,
      name: a.name,
      photo: a.photo,
      type: "Alumni",
      sub: `${a.cadetNumber ? `C.No ${a.cadetNumber} · ` : ""}Batch ${a.batch || "N/A"}${a.house ? ` · ${a.house} House` : ""}`,
      verified: a.verified !== false,
      privacy: a.privacy || "PUBLIC",
      updated: a.lastUpdated || "",
      rawType: "alumni"
    })),
    ...(DB.cadetsData || []).map(c => ({
      id: c.id,
      name: c.name,
      photo: c.photo,
      type: "Cadet",
      sub: `${c.cadetNumber ? `C.No ${c.cadetNumber} · ` : ""}Batch ${c.batch || "N/A"}${c.house ? ` · ${c.house} House` : ""}`,
      verified: c.verified !== false,
      privacy: c.privacy || "AUTHORIZED",
      updated: c.lastUpdated || "",
      rawType: "cadet"
    })),
    ...(DB.administrationData || []).map(adm => ({
      id: adm.id,
      name: adm.name,
      photo: adm.photo,
      type: "Administration",
      sub: `${adm.position || "Faculty"}${adm.department ? ` · ${adm.department}` : ""}`,
      verified: adm.verified !== false,
      privacy: "PUBLIC",
      updated: adm.lastUpdated || "",
      rawType: "admin"
    })),
    ...(DB.achievementData || []).map(ach => ({
      id: ach.id,
      name: ach.title,
      photo: "",
      type: "Achievement",
      sub: [ach.recipient, ach.year, ach.category].filter(Boolean).join(" · "),
      verified: ach.verified !== false,
      privacy: "PUBLIC",
      updated: ach.year || "",
      rawType: "achievement"
    }))
  ];

  let filtered = allRecords;

  if (tFilter && tFilter !== "ALL") {
    filtered = filtered.filter(r => r.rawType === tFilter || (tFilter === "administration" && r.rawType === "admin"));
  }

  if (q) {
    filtered = filtered.filter(r =>
      r.name.toLowerCase().includes(q) ||
      r.sub.toLowerCase().includes(q) ||
      r.type.toLowerCase().includes(q) ||
      r.privacy.toLowerCase().includes(q)
    );
  }

  // Update total records badge
  const totalRecEl = document.getElementById("totalRecordsCount");
  if (totalRecEl) totalRecEl.textContent = allRecords.length;

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:2.5rem; color:var(--text-muted); font-size:0.95rem;">No records found ${q ? `matching "${escapeHtml(filterQuery)}"` : "in this category"}.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(r => `
    <tr>
      <td>
        <div style="display:flex; align-items:center; gap:0.65rem;">
          ${r.photo ? `<img src="${r.photo}" class="table-avatar-img" alt="${escapeHtml(r.name)}" onerror="this.style.display='none';">` : `<span style="display:inline-flex; width:34px; height:34px; border-radius:50%; background:var(--bg-surface-elevated); border:1px solid rgba(197,160,89,0.3); align-items:center; justify-content:center; font-size:1rem; flex-shrink:0;">${r.rawType === 'alumni' ? '🌟' : r.rawType === 'cadet' ? '👤' : r.rawType === 'achievement' ? '🏆' : '🎖️'}</span>`}
          <div style="display:flex; flex-direction:column;">
            <strong style="color:var(--text-primary); font-size:0.9rem;">${escapeHtml(r.name)}</strong>
            <span style="font-size:0.75rem; color:var(--text-muted);">${r.rawType === 'achievement' ? 'Administrator-provided achievement' : 'Administrator-provided record'}</span>
          </div>
        </div>
      </td>
      <td><span class="type-pill type-${r.rawType}">${escapeHtml(r.type)}</span></td>
      <td style="font-size:0.85rem; color:var(--text-secondary);">${escapeHtml(r.sub)}</td>
      <td><span class="${r.verified ? 'status-verified' : 'status-pending'}">${r.verified ? '✓ Verified' : '⚠ Pending'}</span></td>
      <td><span style="font-family:var(--font-mono); font-size:0.75rem; color:var(--color-gold);">${escapeHtml(r.privacy)}</span></td>
      <td style="font-family:var(--font-mono); font-size:0.8rem; color:var(--text-muted);">${escapeHtml(r.updated)}</td>
      <td>
        <div class="action-btn-group">
          <button type="button" class="btn-table-action" onclick="openProfileModal('${r.rawType}', '${r.id}')" title="Inspect Record">Inspect</button>
          <button type="button" class="btn-table-action primary" onclick="openEditRecordModal('${r.rawType}', '${r.id}')" title="Edit Record">✏️ Edit</button>
          <button type="button" class="btn-table-action danger" onclick="deleteRecordAction('${r.rawType}', '${r.id}')" title="Delete Record">🗑️ Delete</button>
        </div>
      </td>
    </tr>
  `).join("");
}

function renderAuditLogTable() {
  const tbody = document.getElementById("auditLogTbody");
  if (!tbody) return;

  if (!DB.auditLog || !DB.auditLog.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:2.5rem; color:var(--text-muted);">No audit log entries recorded yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = DB.auditLog.map(log => `
    <tr>
      <td style="font-family:var(--font-mono); font-size:0.8rem; white-space:nowrap; color:var(--text-muted);">${escapeHtml(log.timestamp)}</td>
      <td><strong style="color:var(--text-primary);">${escapeHtml(log.user || "Admin")}</strong></td>
      <td><span style="font-family:var(--font-mono); color:var(--color-gold); font-size:0.8rem; font-weight:600; background:rgba(197,160,89,0.1); padding:2px 6px; border-radius:4px;">${escapeHtml(log.action)}</span></td>
      <td><strong style="font-size:0.88rem; color:var(--text-primary);">${escapeHtml(log.entity)}</strong></td>
      <td style="font-size:0.85rem; color:var(--text-secondary);">${escapeHtml(log.details)}</td>
    </tr>
  `).join("");

  const auditBadge = document.getElementById("auditCountBadge");
  if (auditBadge) auditBadge.textContent = DB.auditLog.length;
}

function logAuditAction(user, action, entity, details) {
  if (!DB.auditLog) DB.auditLog = [];
  const now = new Date();
  const timestamp = `${now.toISOString().split("T")[0]} ${now.toTimeString().split(" ")[0].slice(0, 5)}`;
  const entry = { timestamp, user: user || "Admin", action, entity, details };
  DB.auditLog.unshift(entry);
  StorageManager.saveData(DB);
  renderAuditLogTable();
  const auditBadge = document.getElementById("auditCountBadge");
  if (auditBadge) auditBadge.textContent = DB.auditLog.length;
}

// ============================================================================
// 11B. ADMIN SAMPLE QUESTIONS & Q&A KNOWLEDGE BASE MANAGEMENT
// ============================================================================

function renderQaCards(filterCategory = "ALL", searchQuery = "") {
  const container = document.getElementById("qaTableContainer");
  const badge = document.getElementById("qaCountBadge");
  if (!container) return;

  const currentCat = filterCategory === "ALL" ? (document.getElementById("qaCategoryFilter")?.value || "ALL") : filterCategory;
  const query = (searchQuery || document.getElementById("qaSearchInput")?.value || "").toLowerCase().trim();

  let list = DB.sampleQuestions || [];

  if (currentCat !== "ALL") {
    list = list.filter(item => (item.category || "").toLowerCase() === currentCat.toLowerCase());
  }

  if (query) {
    list = list.filter(item => {
      const q = (item.question || "").toLowerCase();
      const a = (item.answer || "").toLowerCase();
      const c = (item.category || "").toLowerCase();
      const kws = (item.keywords || []).join(" ").toLowerCase();
      return q.includes(query) || a.includes(query) || c.includes(query) || kws.includes(query);
    });
  }

  if (badge) {
    badge.textContent = String(DB.sampleQuestions ? DB.sampleQuestions.length : 0);
  }

  if (!list.length) {
    container.innerHTML = `
      <div class="empty-state-card" style="grid-column: 1 / -1; padding: 2.5rem; text-align: center; border: 1px dashed var(--border-subtle); border-radius: var(--radius-lg); background: var(--bg-surface-elevated);">
        <div class="empty-icon" style="font-size: 2.5rem; margin-bottom: 0.5rem;">💡</div>
        <h3 class="empty-title" style="margin-bottom: 0.25rem;">No Sample Questions Found</h3>
        <p class="empty-sub" style="color: var(--text-secondary); margin-bottom: 1rem;">No questions match your current search or category filter. Add a new question to expand the robotic voice AI's authoritative answers.</p>
        <button type="button" class="btn-institutional-primary" onclick="openAddQaModal()">
          <span>➕ Add Sample Question</span>
        </button>
      </div>
    `;
    return;
  }

  container.innerHTML = list.map(item => {
    const kws = (item.keywords || []).map(k => escapeHtml(k)).join(", ");
    const varCount = item.variations ? item.variations.length : 0;

    return `
      <div class="qa-card" id="qa-card-${item.id}">
        <div class="qa-card-head">
          <span class="qa-category-tag">${escapeHtml(item.category || "General")}</span>
          <span style="font-size:0.75rem; color:var(--text-muted); font-family:var(--font-mono);">${varCount} creative variations</span>
        </div>
        <h4 class="qa-card-question">"${escapeHtml(item.question)}"</h4>
        <div class="qa-card-keywords">
          <span style="color:var(--color-gold); font-weight:600;">Match Keywords:</span> ${kws || "Default query"}
        </div>
        <div class="qa-card-answer">
          <strong>Voice Spoken Answer:</strong><br>
          ${escapeHtml(item.answer)}
        </div>
        ${varCount > 0 ? `
          <div class="qa-card-variations">
            <span style="font-size:0.75rem; color:var(--text-secondary); font-weight:600;">Re-ask Creative Variation:</span>
            <span>"${escapeHtml(item.variations[0])}"</span>
          </div>
        ` : ""}
        <div class="qa-card-actions">
          <button type="button" class="btn-qa-action" onclick="openEditQaModal('${item.id}')">
            <span>✏️ Edit</span>
          </button>
          <button type="button" class="btn-qa-action danger" onclick="deleteQaItem('${item.id}')">
            <span>🗑️ Delete</span>
          </button>
        </div>
      </div>
    `;
  }).join("");
}

function openAddQaModal() {
  const modal = document.getElementById("qaModal");
  const form = document.getElementById("qaForm");
  const title = document.getElementById("qaModalTitle");
  if (!modal || !form) return;

  form.reset();
  document.getElementById("qaFormId").value = "";
  if (title) title.textContent = "Add Sample Question & Answer";

  modal.removeAttribute("hidden");
  modal.classList.remove("is-hidden");
  modal.style.removeProperty("display");
  modal.style.display = "flex";
}

function openEditQaModal(id) {
  const item = (DB.sampleQuestions || []).find(q => q.id === id);
  if (!item) return;

  const modal = document.getElementById("qaModal");
  const title = document.getElementById("qaModalTitle");
  if (!modal) return;

  if (title) title.textContent = "Edit Sample Question & Answer";

  document.getElementById("qaFormId").value = item.id;
  document.getElementById("qaFormQuestion").value = item.question || "";
  document.getElementById("qaFormCategory").value = item.category || "College Identity";
  document.getElementById("qaFormKeywords").value = (item.keywords || []).join(", ");
  document.getElementById("qaFormAnswer").value = item.answer || "";
  document.getElementById("qaFormVariations").value = (item.variations || []).join("\n");

  modal.removeAttribute("hidden");
  modal.classList.remove("is-hidden");
  modal.style.removeProperty("display");
  modal.style.display = "flex";
}

function closeQaModal() {
  const modal = document.getElementById("qaModal");
  if (modal) {
    modal.setAttribute("hidden", "true");
    modal.classList.add("is-hidden");
    modal.style.display = "none";
  }
}

function handleQaFormSubmit(e) {
  e.preventDefault();
  const id = document.getElementById("qaFormId")?.value.trim();
  const question = document.getElementById("qaFormQuestion")?.value.trim();
  const category = document.getElementById("qaFormCategory")?.value.trim();
  const keywordsRaw = document.getElementById("qaFormKeywords")?.value.trim();
  const answer = document.getElementById("qaFormAnswer")?.value.trim();
  const variationsRaw = document.getElementById("qaFormVariations")?.value.trim();

  if (!question || !answer) {
    showToast("Question and Spoken Answer are required.", "danger");
    return;
  }

  const keywords = keywordsRaw ? keywordsRaw.split(",").map(k => k.trim()).filter(Boolean) : [question.toLowerCase()];
  const variations = variationsRaw ? variationsRaw.split("\n").map(v => v.trim()).filter(Boolean) : [];
  const today = new Date().toISOString().split("T")[0];

  if (!DB.sampleQuestions) DB.sampleQuestions = [];

  if (id) {
    // Edit existing
    const idx = DB.sampleQuestions.findIndex(q => q.id === id);
    if (idx !== -1) {
      DB.sampleQuestions[idx] = {
        ...DB.sampleQuestions[idx],
        question,
        category,
        keywords,
        answer,
        variations,
        lastUpdated: today
      };
      logAuditAction("Admin", "EDIT_SAMPLE_QUESTION", question, `Updated sample question answer and ${variations.length} creative variations.`);
    }
  } else {
    // Add new
    const newId = "sq-" + Date.now();
    const newItem = {
      id: newId,
      question,
      category: category || "Custom Topic",
      keywords,
      answer,
      variations,
      lastUpdated: today
    };
    DB.sampleQuestions.unshift(newItem);
    logAuditAction("Admin", "ADD_SAMPLE_QUESTION", question, `Added new sample question under ${category}.`);
  }

  StorageManager.saveData(DB);
  renderQaCards();
  refreshAdminStats();
  closeQaModal();
  showToast(`Sample question "${question}" saved successfully!`, "success");
}

async function deleteQaItem(id) {
  const item = (DB.sampleQuestions || []).find(q => q.id === id);
  if (!item) return;

  const confirmed = await showConfirmDialog({
    title: "Delete Sample Question",
    message: `Are you sure you want to delete the sample question "${item.question}"?`,
    confirmText: "Delete Question",
    isDanger: true
  });

  if (!confirmed) return;

  DB.sampleQuestions = DB.sampleQuestions.filter(q => q.id !== id);
  logAuditAction("Admin", "DELETE_SAMPLE_QUESTION", item.question, "Sample question removed from knowledge base.");
  StorageManager.saveData(DB);
  renderQaCards();
  refreshAdminStats();
  showToast(`Sample question "${item.question}" has been deleted.`, "success");
}

// ============================================================================
// 12. PROTOTYPE VOICE ADMIN UPDATE WORKFLOW
// ============================================================================

const VoiceAdmin = {
  activeStep: 0,
  extractedData: {
    person: null,
    action: "ADD_ACHIEVEMENT",
    achievement: null,
    year: String(new Date().getFullYear())
  },

  open() {
    const modal = document.getElementById("voiceAdminModal");
    const status = document.getElementById("voiceAdminStatus");
    const trans = document.getElementById("voiceAdminTranscript");
    const card = document.getElementById("voiceConfirmCard");

    this.activeStep = 0;
    this.extractedData = { person: null, action: "ADD_ACHIEVEMENT", achievement: null, year: String(new Date().getFullYear()) };

    if (status) status.textContent = "Speak the name of a person already in the admin records.";
    if (trans) trans.textContent = "Waiting for speech input...";
    if (card) card.setAttribute("hidden", "true");

    if (modal) {
      modal.removeAttribute("hidden");
      modal.classList.remove("is-hidden");
      modal.style.removeProperty("display");
      modal.style.display = "flex";
    }
  },

  close() {
    SpeechEngine.captureCallback = null;
    const modal = document.getElementById("voiceAdminModal");
    if (modal) {
      modal.setAttribute("hidden", "true");
      modal.classList.add("is-hidden");
      modal.style.display = "none";
    }
  },

  processSpeech(text) {
    const clean = text.toLowerCase();
    const status = document.getElementById("voiceAdminStatus");
    const trans = document.getElementById("voiceAdminTranscript");
    const card = document.getElementById("voiceConfirmCard");

    if (trans) trans.textContent = `"${text}"`;

    if (this.activeStep === 0) {
      const people = [
        ...DB.cadetsData,
        ...DB.alumniData.filter(person => person.privacy === "PUBLIC"),
        ...DB.administrationData
      ];
      const matchedPerson = people.find(person => clean.includes(person.name.toLowerCase()));
      if (!matchedPerson) {
        if (status) status.textContent = "No matching admin record found. Try a name from the records.";
        return;
      }

      this.extractedData.person = matchedPerson.name;
      this.activeStep = 1;

      if (status) status.textContent = `Recognized ${matchedPerson.name}. Now speak the achievement details.`;
      SpeechEngine.speak(`What achievement should I add for ${matchedPerson.name}?`);
    } else if (this.activeStep === 1) {
      this.extractedData.achievement = text;
      this.extractedData.year = text.match(/\b(?:19|20)\d{2}\b/)?.[0] || String(new Date().getFullYear());
      this.activeStep = 2;

      // Populate preview card
      document.getElementById("vConfPerson").textContent = this.extractedData.person;
      document.getElementById("vConfAction").textContent = "ADD_ACHIEVEMENT";
      document.getElementById("vConfDetail").textContent = this.extractedData.achievement;
      document.getElementById("vConfYear").textContent = this.extractedData.year;

      card.removeAttribute("hidden");
      if (status) status.textContent = "Proposed update parsed. Review and confirm below.";
      SpeechEngine.speak(`I parsed: ${this.extractedData.achievement} for ${this.extractedData.person}. Please confirm.`);
    }
  },

  confirmAndSave() {
    const pName = this.extractedData.person;
    const achText = this.extractedData.achievement;
    const year = this.extractedData.year;

    // Append to achievements array
    const newAch = {
      id: "ach-" + Date.now(),
      title: achText,
      recipient: pName,
      batch: "",
      year: year,
      category: "Professional",
      verified: false,
      desc: `Voice command entry recorded for ${pName}: ${achText}`
    };
    DB.achievementData.push(newAch);

    // Update target person
    const target = [...DB.alumniData, ...DB.cadetsData, ...DB.administrationData]
      .find(person => person.name.toLowerCase() === pName.toLowerCase());
    if (target) {
      if (!Array.isArray(target.achievements)) target.achievements = [];
      target.achievements.push(`${achText} (${year})`);
      target.verified = false; // Mark pending verification
      target.lastUpdated = new Date().toISOString().split("T")[0];
    }

    logAuditAction("VoiceAdmin", "VOICE_ADD_ACHIEVEMENT", pName, `Added pending achievement: ${achText}`);
    StorageManager.saveData(DB);
    refreshAdminStats();
    renderPendingQueue();

    this.close();
    showToast(`Achievement "${achText}" logged for ${pName} as PENDING VERIFICATION.`, "success");
  }
};

// ============================================================================
// 13. DOM INITIALIZATION & EVENT BINDINGS
// ============================================================================

document.addEventListener("DOMContentLoaded", () => {
  // 1. Initialize Canvas Visualizer & Speech Engine
  AudioVisualizer.init();
  SpeechEngine.init();

  // 2. Theme Management (Persistent)
  const savedTheme = localStorage.getItem("mcc_ai_theme") || "dark";
  document.documentElement.setAttribute("data-theme", savedTheme);

  document.getElementById("themeToggleBtn")?.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", current);
    localStorage.setItem("mcc_ai_theme", current);
  });

  // 3. Language Switchers (English / Bangla)
  document.getElementById("langEnBtn")?.addEventListener("click", () => {
    document.getElementById("langEnBtn").classList.add("active");
    document.getElementById("langBnBtn").classList.remove("active");
    SpeechEngine.setLanguage("en");
  });

  document.getElementById("langBnBtn")?.addEventListener("click", () => {
    document.getElementById("langBnBtn").classList.add("active");
    document.getElementById("langEnBtn").classList.remove("active");
    SpeechEngine.setLanguage("bn");
  });

  // 4. Mobile Navigation Hamburger
  const hamburger = document.getElementById("hamburgerBtn");
  const mobileDrawer = document.getElementById("mobileNavDrawer");
  hamburger?.addEventListener("click", () => {
    const isHidden = mobileDrawer.hidden;
    mobileDrawer.hidden = !isHidden;
    hamburger.setAttribute("aria-expanded", String(!isHidden));
  });

  // 5. Navigation Links Routing
  document.querySelectorAll("[data-view]").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const view = btn.getAttribute("data-view");
      if (view) {
        window.location.hash = view;
        switchView(view);
      }
    });
  });

  // Initialize Robotic Face Controller
  RobotController.init();

  window.addEventListener("hashchange", () => {
    const hash = window.location.hash.replace("#", "") || "robot";
    switchView(hash);
  });

  // Handle initial hash on page load (Default to Robotic Voice AI)
  const initialHash = window.location.hash.replace("#", "");
  if (initialHash === "admin") {
    switchView("admin");
  } else {
    switchView("robot");
  }

  // 6. Primary Mic Button & Quick Input on Home
  const homeMic = document.getElementById("primaryMicBtn");
  homeMic?.addEventListener("click", () => {
    if (SpeechEngine.isListening) {
      SpeechEngine.stopListening();
    } else {
      SpeechEngine.startListening();
    }
  });

  const chatMic = document.getElementById("chatMicBtn");
  chatMic?.addEventListener("click", () => {
    if (SpeechEngine.isListening) {
      SpeechEngine.stopListening();
    } else {
      SpeechEngine.startListening();
    }
  });

  // Quick text form on Home
  document.getElementById("quickInputForm")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const input = document.getElementById("quickTextInput");
    if (input && input.value.trim()) {
      const q = input.value.trim();
      input.value = "";
      handleQuerySubmission(q);
    }
  });

  // Home Answer Card Actions
  document.getElementById("homeAnsReplayBtn")?.addEventListener("click", function() {
    const text = this.getAttribute("data-speech");
    if (text) SpeechEngine.speak(text);
  });

  document.getElementById("homeOpenChatBtn")?.addEventListener("click", () => {
    switchView("ask-ai");
  });

  // Chat bar text submission
  document.getElementById("chatSendBtn")?.addEventListener("click", () => {
    const input = document.getElementById("chatTextInput");
    if (input && input.value.trim()) {
      const q = input.value.trim();
      input.value = "";
      handleQuerySubmission(q);
    }
  });

  document.getElementById("chatTextInput")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const q = e.target.value.trim();
      if (q) {
        e.target.value = "";
        handleQuerySubmission(q);
      }
    }
  });

  // Suggested Chips
  document.querySelectorAll("[data-question]").forEach(chip => {
    chip.addEventListener("click", () => {
      const q = chip.getAttribute("data-question");
      handleQuerySubmission(q);
    });
  });

  // Speech Controls
  document.getElementById("bannerStopBtn")?.addEventListener("click", () => SpeechEngine.stopSpeaking());
  document.getElementById("stopSpeechBtn")?.addEventListener("click", () => SpeechEngine.stopSpeaking());

  document.getElementById("speechRateSelect")?.addEventListener("change", (e) => {
    SpeechEngine.speechRate = parseFloat(e.target.value);
  });

  document.getElementById("clearChatBtn")?.addEventListener("click", () => {
    const stream = document.getElementById("chatStream");
    if (stream) {
      stream.innerHTML = `
        <div class="chat-bubble ai-bubble initial-bubble">
          <div class="bubble-header"><span class="speaker-name">MCC AI</span><span class="verified-tag">✓ Memory Cleared</span></div>
          <div class="bubble-content"><p>Conversation history cleared. Ask a question about administrator-provided information.</p></div>
        </div>
      `;
    }
  });

  document.getElementById("resetContextBtn")?.addEventListener("click", () => {
    updateContextDisplay({ category: "GENERAL", intent: "RESET" });
    showToast("Conversation memory context has been reset.", "info");
  });

  // Subnavigation for College View
  document.getElementById("collegeSubnav")?.querySelectorAll(".segment-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.getElementById("collegeSubnav").querySelectorAll(".segment-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      renderCollegeSection(btn.getAttribute("data-subview"));
    });
  });

  // Filters for Administration
  document.getElementById("adminFilterTabs")?.querySelectorAll(".filter-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.getElementById("adminFilterTabs").querySelectorAll(".filter-tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      renderAdministrationGrid(tab.getAttribute("data-filter"), document.getElementById("adminSearchInput")?.value || "");
    });
  });

  document.getElementById("adminSearchInput")?.addEventListener("input", (e) => {
    const activeFilter = document.querySelector("#adminFilterTabs .filter-tab.active")?.getAttribute("data-filter") || "all";
    renderAdministrationGrid(activeFilter, e.target.value);
  });

  // Filters for Cadets
  document.getElementById("cadetHouseFilter")?.querySelectorAll(".filter-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.getElementById("cadetHouseFilter").querySelectorAll(".filter-tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      renderCadetsGrid(tab.getAttribute("data-house"), document.getElementById("cadetSearchInput")?.value || "");
    });
  });

  document.getElementById("cadetSearchInput")?.addEventListener("input", (e) => {
    const activeHouse = document.querySelector("#cadetHouseFilter .filter-tab.active")?.getAttribute("data-house") || "all";
    renderCadetsGrid(activeHouse, e.target.value);
  });

  // Filters for Alumni
  document.getElementById("alumniProfessionFilter")?.querySelectorAll(".filter-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.getElementById("alumniProfessionFilter").querySelectorAll(".filter-tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      renderAlumniGrid(tab.getAttribute("data-prof"), document.getElementById("alumniSearchInput")?.value || "");
    });
  });

  document.getElementById("alumniSearchInput")?.addEventListener("input", (e) => {
    const activeProf = document.querySelector("#alumniProfessionFilter .filter-tab.active")?.getAttribute("data-prof") || "all";
    renderAlumniGrid(activeProf, e.target.value);
  });

  // Filters for Achievements
  document.getElementById("achievementsCatFilter")?.querySelectorAll(".filter-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.getElementById("achievementsCatFilter").querySelectorAll(".filter-tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      renderAchievementsGrid(tab.getAttribute("data-cat"), document.getElementById("achieveSearchInput")?.value || "");
    });
  });

  document.getElementById("achieveSearchInput")?.addEventListener("input", (e) => {
    const activeCat = document.querySelector("#achievementsCatFilter .filter-tab.active")?.getAttribute("data-cat") || "all";
    renderAchievementsGrid(activeCat, e.target.value);
  });

  // Global Search inputs
  document.getElementById("globalSearchInput")?.addEventListener("input", () => executeGlobalSearch());
  document.querySelectorAll(".search-filters-row input").forEach(chk => {
    chk.addEventListener("change", () => executeGlobalSearch());
  });

  // Admin Auth Form
  document.getElementById("adminLoginForm")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const u = document.getElementById("adminUsernameInput")?.value.trim();
    const p = document.getElementById("adminPasswordInput")?.value.trim();
    const err = document.getElementById("loginErrorMsg");

    if (u === "admin" && p === "mcc2026") {
      isAdminAuthenticated = true;
      sessionStorage.setItem("mcc_admin_session", "true");
      err?.setAttribute("hidden", "true");
      checkAdminSession();
      showToast("Administrative console unlocked.", "success");
    } else {
      err?.removeAttribute("hidden");
    }
  });

  document.getElementById("adminLogoutBtn")?.addEventListener("click", () => {
    isAdminAuthenticated = false;
    sessionStorage.removeItem("mcc_admin_session");
    checkAdminSession();
    showToast("Signed out of administrative console.", "info");
  });

  // Admin Management Subtabs
  document.getElementById("adminSubTabs")?.querySelectorAll(".segment-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.getElementById("adminSubTabs").querySelectorAll(".segment-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const tabId = btn.getAttribute("data-tab");
      document.querySelectorAll(".admin-subview").forEach(v => {
        if (v.id === `adminTab-${tabId}`) v.removeAttribute("hidden");
        else v.setAttribute("hidden", "true");
      });
      if (tabId === "qa") {
        renderQaCards();
      } else if (tabId === "people") {
        renderAdminDataTable();
      } else if (tabId === "audit") {
        renderAuditLogTable();
      }
      refreshAdminStats();
    });
  });

  // Live search and category filter for All Knowledge Records
  const adminManageSearchInput = document.getElementById("adminManageSearch");
  const adminRecordsTypeFilter = document.getElementById("adminRecordsTypeFilter");

  adminManageSearchInput?.addEventListener("input", (e) => {
    renderAdminDataTable(e.target.value, adminRecordsTypeFilter?.value);
  });

  adminRecordsTypeFilter?.addEventListener("change", (e) => {
    renderAdminDataTable(adminManageSearchInput?.value, e.target.value);
  });

  // QA Knowledge Base Listeners
  document.getElementById("openAddQaModalBtn")?.addEventListener("click", () => openAddQaModal());
  document.getElementById("closeQaModalBtn")?.addEventListener("click", () => closeQaModal());
  document.getElementById("qaSearchInput")?.addEventListener("input", (e) => renderQaCards(undefined, e.target.value));
  document.getElementById("qaCategoryFilter")?.addEventListener("change", (e) => renderQaCards(e.target.value));
  document.getElementById("qaForm")?.addEventListener("submit", handleQaFormSubmit);

  // Manual Add Form submission
  document.getElementById("addRecordForm")?.addEventListener("submit", (e) => {
    e.preventDefault();
    handleManualRecordSave(true);
  });
  document.getElementById("saveAsPendingBtn")?.addEventListener("click", () => {
    handleManualRecordSave(false);
  });

  // Voice Admin Modal handlers
  document.getElementById("adminVoiceConsoleBtn")?.addEventListener("click", () => VoiceAdmin.open());
  document.getElementById("closeVoiceAdminBtn")?.addEventListener("click", () => VoiceAdmin.close());
  document.getElementById("voiceAdminMicBtn")?.addEventListener("click", () => {
    SpeechEngine.captureCallback = text => VoiceAdmin.processSpeech(text);
    SpeechEngine.startListening();
  });
  document.getElementById("vConfAcceptBtn")?.addEventListener("click", () => VoiceAdmin.confirmAndSave());
  document.getElementById("vConfCancelBtn")?.addEventListener("click", () => VoiceAdmin.close());

  // Reset Baseline Data
  document.getElementById("resetDataDefaultBtn")?.addEventListener("click", async () => {
    const confirmed = await showConfirmDialog({
      title: "Clear Admin Knowledge Base",
      message: "Are you sure you want to remove all administrator-entered information? This cannot be undone.",
      confirmText: "Clear Knowledge Base",
      isDanger: true
    });
    if (!confirmed) return;

    DB = StorageManager.resetDefaults();
    refreshAdminStats();
    renderPendingQueue();
    renderAdminDataTable();
    renderQaCards();
    showToast("Admin knowledge base cleared.", "success");
  });

  // Edit Record Form Submit & Cancel
  document.getElementById("editRecordForm")?.addEventListener("submit", handleEditRecordSubmit);
  document.getElementById("cancelEditBtn")?.addEventListener("click", () => closeEditRecordModal());
  document.getElementById("closeEditModalBtn")?.addEventListener("click", () => closeEditRecordModal());

  // College Info Editor Form Submit
  const collegeForm = document.getElementById("editCollegeInfoForm");
  if (collegeForm) {
    const titleInput = document.getElementById("collegeTitleInput");
    const mottoInput = document.getElementById("collegeMottoInput");
    const estInput = document.getElementById("collegeEstInput");
    const areaInput = document.getElementById("collegeAreaInput");
    const distInput = document.getElementById("collegeDistrictInput");
    const histText = document.getElementById("collegeHistoryTextarea");

    if (titleInput) titleInput.value = DB.collegeData.history.title || "";
    if (mottoInput) mottoInput.value = DB.collegeData.history.motto || "";
    if (estInput) estInput.value = DB.collegeData.history.established || "";
    if (areaInput) areaInput.value = DB.collegeData.history.area || "";
    if (distInput) distInput.value = DB.collegeData.history.district || "";
    if (histText) histText.value = DB.collegeData.history.content || "";

    collegeForm.addEventListener("submit", (e) => {
      e.preventDefault();
      DB.collegeData.history.title = titleInput?.value.trim() || "";
      DB.collegeData.history.motto = mottoInput?.value.trim() || "";
      DB.collegeData.history.established = estInput?.value.trim() || "";
      DB.collegeData.history.area = areaInput?.value.trim() || "";
      DB.collegeData.history.district = distInput?.value.trim() || "";
      DB.collegeData.history.content = histText?.value.trim() || "";
      DB.collegeData.history.lastUpdated = new Date().toISOString().split("T")[0];

      logAuditAction("Admin", "UPDATE_COLLEGE_INFO", "Institution History", "Updated administrator-provided institution information.");
      StorageManager.saveData(DB);
      renderCollegeSection("overview");
      showToast("College history and profile updated successfully!", "success");
    });
  }

  // Modal Closers
  document.getElementById("closeProfileModalBtn")?.addEventListener("click", () => closeProfileModal());
  document.getElementById("closeVersionModalBtn")?.addEventListener("click", () => closeVersionHistoryModal());
  document.getElementById("cancelVersionModalBtn")?.addEventListener("click", () => closeVersionHistoryModal());

  // Click backdrop outside dialog to close any open modal
  document.querySelectorAll(".modal-backdrop").forEach(backdrop => {
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) {
        backdrop.setAttribute("hidden", "true");
        backdrop.classList.add("is-hidden");
        backdrop.style.display = "none";
      }
    });
  });

  // ESC key closes any open modal
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeProfileModal();
      closeVersionHistoryModal();
      closeEditRecordModal();
      closeQaModal();
      VoiceAdmin.close();
      const confirmModal = document.getElementById("appConfirmModal");
      if (confirmModal) {
        confirmModal.setAttribute("hidden", "true");
        confirmModal.classList.add("is-hidden");
        confirmModal.style.display = "none";
      }
    }
  });

  // JSON Export / Import
  document.getElementById("exportDbBtn")?.addEventListener("click", () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(DB, null, 2));
    const dlAnchor = document.createElement("a");
    dlAnchor.setAttribute("href", dataStr);
    dlAnchor.setAttribute("download", `mcc_knowledge_backup_${Date.now()}.json`);
    dlAnchor.click();
  });

  document.getElementById("importDbFile")?.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const imported = JSON.parse(event.target.result);
          if (imported.collegeData && imported.alumniData) {
            DB = imported;
            StorageManager.saveData(DB);
            refreshAdminStats();
            renderPendingQueue();
            renderAdminDataTable();
            showToast("Database successfully restored from JSON snapshot!", "success");
          }
        } catch (err) {
          showToast("Error parsing JSON file. Please provide a valid database dump.", "danger");
        }
      };
      reader.readAsText(file);
    }
  });

  // Initialize photo upload / preview handlers for both Add Record form and Edit Record modal
  setupPhotoInputHandlers("form");
  setupPhotoInputHandlers("edit");

  // Dynamic field toggling for Add Record form
  const formRecordTypeSelect = document.getElementById("formRecordType");
  const formCadetRow = document.getElementById("formCadetRow");
  const formHouseRow = document.getElementById("formHouseRow");
  const formClassRow = document.getElementById("formClassRow");
  const formClassSelect = document.getElementById("formClass");
  if (formRecordTypeSelect && formCadetRow && formHouseRow) {
    const updateFormVisibility = () => {
      const val = formRecordTypeSelect.value;
      const isCadet = val === "cadet";
      if (val === "alumni" || val === "cadet") {
        formCadetRow.style.display = "grid";
        formHouseRow.style.display = "grid";
      } else if (val === "administration") {
        formCadetRow.style.display = "none";
        formHouseRow.style.display = "none";
      } else {
        formCadetRow.style.display = "none";
        formHouseRow.style.display = "none";
      }
      if (formClassRow) formClassRow.hidden = !isCadet;
      if (formClassSelect) {
        formClassSelect.required = isCadet;
        if (!isCadet) formClassSelect.value = "";
      }
    };
    formRecordTypeSelect.addEventListener("change", updateFormVisibility);
    updateFormVisibility();
  }

  // Initial renders
  renderCollegeSection("overview");
  renderAdministrationGrid();
  renderCadetsGrid();
  renderAlumniGrid();
  renderAchievementsGrid();
  renderBatchesSection();
  renderHousesGrid();
  renderEventsList();
  renderQaCards();
  renderAdminDataTable();
  renderAuditLogTable();
  refreshAdminStats();
});

function handleManualRecordSave(verified) {
  const type = document.getElementById("formRecordType").value;
  const name = document.getElementById("formFullName").value.trim();
  const cadetNumber = document.getElementById("formCadetNumber") ? document.getElementById("formCadetNumber").value.trim() : "";
  const batch = document.getElementById("formBatch") ? document.getElementById("formBatch").value.trim() : "";
  const house = document.getElementById("formHouse") ? document.getElementById("formHouse").value : "";
  const className = document.getElementById("formClass") ? document.getElementById("formClass").value : "";
  const privacy = document.getElementById("formPrivacy") ? document.getElementById("formPrivacy").value : "PUBLIC";
  const photo = document.getElementById("formPhotoData") ? document.getElementById("formPhotoData").value.trim() : "";
  const role = document.getElementById("formRoleProf") ? document.getElementById("formRoleProf").value.trim() : "";
  const org = document.getElementById("formOrganization") ? document.getElementById("formOrganization").value.trim() : "";
  const keywordRaw = document.getElementById("formKeywords") ? document.getElementById("formKeywords").value.trim() : "";
  const achRaw = document.getElementById("formAchievement") ? document.getElementById("formAchievement").value.trim() : "";
  const bio = document.getElementById("formBio") ? document.getElementById("formBio").value.trim() : "";

  if (!name) {
    showToast("Full Name / Title is required.", "danger");
    return;
  }
  if (type === "cadet" && !className) {
    showToast("Select the current cadet's class.", "danger");
    return;
  }

  const achievements = achRaw ? achRaw.split(",").map(s => s.trim()).filter(Boolean) : [];
  const keywords = parseKeywords(keywordRaw);
  const today = new Date().toISOString().split("T")[0];

  if (type === "alumni") {
    const newAlumni = {
      id: "alm-" + Date.now(),
      name,
      cadetNumber: cadetNumber || "",
      photo: photo || "",
      batch,
      house,
      graduationYear: "",
      profession: role,
      role,
      organization: org,
      education: [],
      achievements,
      keywords,
      publications: [],
      biography: bio,
      privacy,
      verified,
      lastUpdated: today
    };
    if (!DB.alumniData) DB.alumniData = [];
    DB.alumniData.unshift(newAlumni);
  } else if (type === "cadet") {
    const newCadet = {
      id: "cdt-" + Date.now(),
      name,
      cadetNumber,
      photo: photo || "",
      batch,
      house,
      className,
      section: org,
      achievements,
      keywords,
      activities: [],
      biography: bio,
      status: verified ? "current" : "pending",
      privacy,
      verified,
      lastUpdated: today
    };
    if (!DB.cadetsData) DB.cadetsData = [];
    DB.cadetsData.unshift(newCadet);
  } else if (type === "administration") {
    const newAdmin = {
      id: "adm-" + Date.now(),
      name,
      photo: photo || "",
      position: role,
      category: "faculty",
      department: org,
      status: "current",
      officialContact: "",
      biography: bio,
      achievements,
      keywords,
      verified,
      lastUpdated: today
    };
    if (!DB.administrationData) DB.administrationData = [];
    DB.administrationData.unshift(newAdmin);
  } else if (type === "achievement") {
    const newAch = {
      id: "ach-" + Date.now(),
      title: name,
      recipient: org,
      batch,
      year: today.split("-")[0],
      category: role,
      verified,
      desc: bio || name
    };
    if (!DB.achievementData) DB.achievementData = [];
    DB.achievementData.unshift(newAch);
  } else if (type === "event") {
    const newEvt = {
      id: "evt-" + Date.now(),
      title: name,
      date: today,
      time: "",
      location: org,
      category: role,
      description: bio
    };
    if (!DB.eventData) DB.eventData = [];
    DB.eventData.unshift(newEvt);
  }

  logAuditAction("Admin", "MANUAL_RECORD_ADD", `${name} (${type.toUpperCase()})`, `Saved to Knowledge Records.${cadetNumber ? ` [C.No: ${cadetNumber}]` : ""}${photo ? " [Photo Added]" : ""}`);
  StorageManager.saveData(DB);
  refreshAdminStats();
  renderPendingQueue();
  renderAdminDataTable();
  renderAuditLogTable();
  renderCadetsGrid();
  renderAlumniGrid();
  renderAdministrationGrid();
  renderAchievementsGrid();
  renderEventsList();

  showToast(`Record for "${name}" successfully saved to All Knowledge Records!`, "success");
  document.getElementById("addRecordForm")?.reset();
  document.getElementById("formRecordType")?.dispatchEvent(new Event("change"));
  const formKeywords = document.getElementById("formKeywords");
  if (formKeywords) formKeywords.value = "";
  setPhotoPreviewState("form", "");

  // Seamlessly switch to the People & Records subtab so the admin views the updated record in All Knowledge Records
  const peopleTabBtn = document.querySelector("#adminSubTabs .segment-btn[data-tab='people']");
  if (peopleTabBtn) {
    peopleTabBtn.click();
  }
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Window Global Bindings
window.openProfileModal = openProfileModal;
window.closeProfileModal = closeProfileModal;
window.openEditRecordModal = openEditRecordModal;
window.closeEditRecordModal = closeEditRecordModal;
window.handleEditRecordSubmit = handleEditRecordSubmit;
window.deleteRecordAction = deleteRecordAction;
window.openVersionHistoryModal = openVersionHistoryModal;
window.closeVersionHistoryModal = closeVersionHistoryModal;
window.verifyRecordAction = verifyRecordAction;
window.rejectRecordAction = rejectRecordAction;
window.handleQuerySubmission = handleQuerySubmission;
window.handleRobotQuerySubmission = handleRobotQuerySubmission;
window.switchView = switchView;
window.VoiceAdmin = VoiceAdmin;
window.openAddQaModal = openAddQaModal;
window.openEditQaModal = openEditQaModal;
window.closeQaModal = closeQaModal;
window.deleteQaItem = deleteQaItem;
window.renderQaCards = renderQaCards;
window.DB = DB;
