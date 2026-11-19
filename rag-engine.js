(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.InceptionRag = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const PUNCTUATION = /[，。！？；：、,.!?;:「」『』（）()【】\[\]{}〈〉《》"'`~@#$%^&*_+=|\\/<>-]+/g;
  const GENERIC_TERMS = new Set(['可以', '怎麼', '如何', '什麼', '規則', '玩家', '時候', '以後', '一個', '幾次', '會怎樣']);
  const QUERY_FILLERS = [
    '請問', '我想知道', '想知道', '告訴我', '同一個回合', '每回合', '玩的時候',
    '可不可以', '能不能', '可以', '是否', '怎麼', '如何', '哪一天', '哪一個',
    '什麼', '哪些', '事情', '發生', '處理', '配置', '規則', '玩家', '其他',
    '收到', '打開', '成功', '最多', '各有', '幾張', '幾次', '之後', '以後',
    '時候', '的', '是', '和', '後', '會', '能', '要', '做', '嗎', '呢'
  ];

  function normalizeText(value) {
    return String(value == null ? '' : value)
      .normalize('NFKC')
      .toLowerCase()
      .replace(PUNCTUATION, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function compact(value) {
    return normalizeText(value).replace(/\s+/g, '');
  }

  function chineseBigrams(value) {
    const chars = compact(value).replace(/[a-z0-9]/g, '');
    const bigrams = new Set();
    for (let index = 0; index < chars.length - 1; index += 1) {
      const term = chars.slice(index, index + 2);
      if (!GENERIC_TERMS.has(term)) bigrams.add(term);
    }
    return bigrams;
  }

  function createRagEngine(data, config) {
    const source = data || {};
    const documents = Array.isArray(source.documents) ? source.documents : [];
    const synonymGroups = Array.isArray(source.synonymGroups) ? source.synonymGroups : [];
    const outOfScopeTerms = Array.isArray(source.outOfScopeTerms) ? source.outOfScopeTerms.map(normalizeText) : [];
    const options = Object.assign({ maxQueryLength: 5000 }, config);

    const prepared = documents.map((document) => {
      const title = normalizeText(document.title);
      const keywords = document.keywords.map(normalizeText);
      const semantic = normalizeText(`${document.title} ${document.text} ${document.keywords.join(' ')}`);
      const combined = normalizeText(`${document.title} ${document.section} ${document.text} ${document.keywords.join(' ')}`);
      return {
        document,
        title,
        keywords,
        combined,
        compact: compact(combined),
        semanticCompact: compact(semantic),
        bigrams: chineseBigrams(semantic)
      };
    });

    const preparedGroups = synonymGroups.map((group) => ({
      canonical: normalizeText(group.canonical),
      terms: group.terms.map(normalizeText)
    }));

    function hasUnsupportedRemainder(context) {
      let remainder = context.normalized;
      const removable = [];
      for (const group of context.groups) {
        removable.push(group.canonical, ...group.terms);
      }
      removable.push(...QUERY_FILLERS);
      removable
        .map(normalizeText)
        .filter((term) => term.length > 0)
        .sort((left, right) => right.length - left.length)
        .forEach((term) => { remainder = remainder.replaceAll(term, ' '); });

      const segments = normalizeText(remainder)
        .split(' ')
        .map(compact)
        .filter((term) => term.length >= 2);
      return segments.some((segment) =>
        !prepared.some((entry) => entry.compact.includes(segment))
      );
    }

    function queryContext(query) {
      const original = String(query == null ? '' : query).slice(0, options.maxQueryLength);
      let normalized = normalizeText(original)
        .replace(/同一個回合/g, '同一回合')
        .replace(/死掉/g, '死亡');
      const compactQuery = compact(normalized);
      const matchedGroups = preparedGroups.filter((group) =>
        group.terms.some((term) => compactQuery.includes(compact(term)))
      );
      const expanded = new Set();
      for (const group of matchedGroups) {
        expanded.add(group.canonical);
        for (const term of group.terms) expanded.add(term);
      }
      return {
        original,
        normalized,
        compact: compactQuery,
        bigrams: chineseBigrams(normalized),
        groups: matchedGroups,
        expanded
      };
    }

    function scoreDocument(context, entry) {
      if (!context.compact) return { score: 0, matchedTerms: [] };
      let score = 0;
      const matchedTerms = new Set();

      if (entry.compact.includes(context.compact) && context.compact.length >= 3) score += 14;
      if (context.compact.includes(compact(entry.title)) && entry.title.length >= 2) {
        score += 11;
        matchedTerms.add(entry.document.title);
      }

      for (const keyword of entry.keywords) {
        const term = compact(keyword);
        if (term.length < 2) continue;
        if (context.compact.includes(term)) {
          score += 8 + Math.min(4, term.length / 2);
          matchedTerms.add(keyword);
        } else if (term.includes(context.compact) && context.compact.length >= 3) {
          score += 4;
          matchedTerms.add(keyword);
        }
      }

      for (const group of context.groups) {
        const groupTerms = [group.canonical].concat(group.terms);
        const hit = groupTerms.find((term) => entry.semanticCompact.includes(compact(term)));
        if (hit) {
          const titleHit = groupTerms.some((term) => compact(entry.title).includes(compact(term)));
          const keywordHit = groupTerms.some((term) => {
            const normalizedTerm = compact(term);
            return entry.keywords.some((keyword) => compact(keyword).includes(normalizedTerm));
          });
          score += titleHit ? 15 : keywordHit ? 11 : 7;
          matchedTerms.add(group.canonical);
        }
      }

      const numberPeople = context.normalized.match(/\d+\s*人/g) || [];
      for (const phrase of numberPeople) {
        if (entry.compact.includes(compact(phrase))) {
          score += 9;
          matchedTerms.add(phrase.replace(/\s+/g, ' '));
        }
      }

      let overlap = 0;
      for (const term of context.bigrams) {
        if (entry.bigrams.has(term)) overlap += 1;
      }
      score += Math.min(12, overlap * 1.2);

      const coverageBase = Math.max(1, context.bigrams.size + context.groups.length);
      score += Math.min(6, ((overlap + context.groups.length) / coverageBase) * 6);

      return { score: Number(score.toFixed(4)), matchedTerms: Array.from(matchedTerms).slice(0, 5) };
    }

    function coverageRerankScore(context, entry, baseScore) {
      const entityGroups = new Set(['夢主', '盜夢者']);
      const queryCanonicals = new Set(context.groups.map((group) => group.canonical));
      let coverageCount = 0;
      let entityMatchCount = 0;
      let titleHitCount = 0;
      let keywordHitCount = 0;
      let offQueryGroupCount = 0;

      for (const group of context.groups) {
        const terms = [group.canonical].concat(group.terms).map(compact);
        if (!terms.some((term) => entry.semanticCompact.includes(term))) continue;
        coverageCount += 1;
        if (entityGroups.has(group.canonical)) entityMatchCount += 1;
        if (terms.some((term) => compact(entry.title).includes(term))) titleHitCount += 1;
        if (terms.some((term) => entry.keywords.some((keyword) => compact(keyword).includes(term)))) {
          keywordHitCount += 1;
        }
      }

      if (context.groups.length > 0) {
        for (const group of preparedGroups) {
          if (queryCanonicals.has(group.canonical)) continue;
          const terms = [group.canonical].concat(group.terms).map(compact);
          const focusedSurface = `${compact(entry.title)} ${entry.keywords.map(compact).join(' ')}`;
          if (terms.some((term) => focusedSurface.includes(term))) offQueryGroupCount += 1;
        }
      }

      return Number((
        baseScore
        + coverageCount * 10
        + entityMatchCount * 8
        + titleHitCount * 4
        + keywordHitCount * 2
        - offQueryGroupCount * 12
      ).toFixed(4));
    }

    function search(query, limit) {
      const context = queryContext(query);
      if (!context.compact) return [];
      const cap = Math.max(1, Math.min(3, Number.isFinite(limit) ? Math.floor(limit) : 3));
      return prepared
        .map((entry) => {
          const scored = scoreDocument(context, entry);
          return {
            document: entry.document,
            score: coverageRerankScore(context, entry, scored.score),
            matchedTerms: scored.matchedTerms
          };
        })
        .filter((result) => result.score > 0)
        .sort((left, right) => right.score - left.score || left.document.id.localeCompare(right.document.id))
        .slice(0, cap)
        .map((result) => Object.assign(result, {
          confidence: Math.min(99, Math.max(1, Math.round((result.score / (result.score + 16)) * 100)))
        }));
    }

    function answer(query) {
      const original = String(query == null ? '' : query).slice(0, options.maxQueryLength);
      const normalized = normalizeText(original);
      const compactQuery = compact(normalized);
      const results = search(original, 3);
      const refusalMessage = '這個問題在目前的《盜夢都市》規則知識庫中找不到足夠依據，因此我不能確定回答。你可以改問開局、回合、移動、解封、攻擊、死亡復活、賄賂、夢魘或行動牌。';
      const genericOnly = new Set(['玩家', '規則', '遊戲', '怎麼', '如何', '什麼']);
      const explicitlyOutOfScope = outOfScopeTerms.some((term) => term && normalized.includes(term));
      const quotedTerms = Array.from(original.matchAll(/[「『"']([^」』"']{2,12})[」』"']/g), (match) => compact(match[1]));
      const unsupportedQuotedTerm = quotedTerms.some((term) =>
        term && !prepared.some((entry) => entry.compact.includes(term))
      );
      const weak = !results.length || results[0].score < 8 || (results[0].matchedTerms.length === 0 && results[0].score < 18);
      const context = queryContext(original);
      const unsupportedRemainder = hasUnsupportedRemainder(context);

      if (!compactQuery || compactQuery.length < 2 || genericOnly.has(compactQuery) || explicitlyOutOfScope || unsupportedQuotedTerm || unsupportedRemainder || weak) {
        return { status: 'refused', message: refusalMessage, citations: [], results };
      }

      const relativeFloor = results[0].score * 0.65;
      const coveredGroups = new Set();
      const selected = [];
      for (const result of results) {
        if (result.score < relativeFloor || result.matchedTerms.length === 0) continue;
        const entry = prepared.find((candidate) => candidate.document.id === result.document.id);
        const groupHits = context.groups.filter((group) =>
          [group.canonical].concat(group.terms).some((term) => entry.semanticCompact.includes(compact(term)))
        );
        const addsConcept = groupHits.some((group) => !coveredGroups.has(group.canonical));
        const hasDirectKeyword = entry.keywords.some((keyword) =>
          keyword.length >= 2 && (context.compact.includes(compact(keyword)) || compact(keyword).includes(context.compact))
        );
        const hasFocusedTitle = groupHits.some((group) =>
          [group.canonical].concat(group.terms).some((term) => compact(entry.title).includes(compact(term)))
        );
        if (selected.length === 0 || addsConcept || hasDirectKeyword || (context.groups.length > 1 && hasFocusedTitle)) {
          selected.push(result);
          for (const group of groupHits) coveredGroups.add(group.canonical);
        }
        if (selected.length === 3) break;
      }
      const grounded = selected.length ? selected : [results[0]];
      const seenAnswers = new Set();
      const parts = [];
      const citations = [];
      for (const result of grounded) {
        const text = result.document.answer.trim();
        if (!text || seenAnswers.has(text)) continue;
        seenAnswers.add(text);
        parts.push(`${text} [${result.document.id}]`);
        citations.push(result.document.id);
      }
      return {
        status: 'answered',
        message: parts.join(' '),
        citations,
        results
      };
    }

    return { normalizeText, search, answer };
  }

  return { createRagEngine };
}));

