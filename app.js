(function () {
  'use strict';

  const MAX_QUERY_LENGTH = 500;

  function init() {
    const data = globalThis.InceptionData;
    const api = globalThis.InceptionRag;
    const form = document.getElementById('question-form');
    const input = document.getElementById('question-input');
    const askButton = document.getElementById('ask-button');
    const commonHost = document.getElementById('common-questions');
    const resultQuestion = document.getElementById('result-question');
    const answerPanel = document.getElementById('answer-panel');
    const statusText = document.getElementById('status-text');
    const answerText = document.getElementById('answer-text');
    const retrievalList = document.getElementById('retrieval-list');
    const template = document.getElementById('retrieval-item-template');

    if (!data || !api || !form || !input || !template) {
      if (statusText) {
        statusText.dataset.status = 'refused';
        statusText.textContent = '系統資料未完整載入';
      }
      if (answerText) answerText.textContent = '請重新整理頁面；若問題持續，請確認專案檔案是否完整。';
      return;
    }

    const engine = api.createRagEngine(data);

    function setSelectedQuestion(question) {
      const buttons = commonHost.querySelectorAll('.common-question');
      for (const button of buttons) {
        button.setAttribute('aria-pressed', button.dataset.question === question ? 'true' : 'false');
      }
    }

    function renderRetrieval(results) {
      retrievalList.replaceChildren();
      if (!results.length) {
        const empty = document.createElement('p');
        empty.className = 'retrieval-empty';
        empty.textContent = '沒有足夠相關的規則片段可顯示。';
        retrievalList.appendChild(empty);
        return;
      }

      results.forEach((result, index) => {
        const item = template.content.firstElementChild.cloneNode(true);
        const rank = item.querySelector('.rank');
        const confidence = item.querySelector('.confidence');
        const track = item.querySelector('.score-track');
        const fill = item.querySelector('.score-track i');
        const meta = item.querySelector('.source-meta');
        const matches = item.querySelector('.matched-terms');
        const sourceText = item.querySelector('.source-text');

        rank.textContent = String(index + 1);
        confidence.textContent = `${result.confidence}%`;
        track.setAttribute('role', 'progressbar');
        track.setAttribute('aria-label', `第 ${index + 1} 筆檢索信心值`);
        track.setAttribute('aria-valuemin', '0');
        track.setAttribute('aria-valuemax', '100');
        track.setAttribute('aria-valuenow', String(result.confidence));
        fill.style.width = `${result.confidence}%`;
        meta.textContent = `文件編號：${result.document.id}　｜　章節：${result.document.section}　｜　PDF 頁碼：${result.document.page}`;
        matches.textContent = result.matchedTerms.length
          ? `命中詞：${result.matchedTerms.join('、')}`
          : '命中詞：語句相似度';
        sourceText.textContent = result.document.text;
        retrievalList.appendChild(item);
      });
    }

    function renderAnswer(result) {
      const answered = result.status === 'answered';
      statusText.dataset.status = result.status;
      statusText.textContent = answered
        ? '已找到相關規則並作答'
        : '知識庫依據不足，已停止作答';
      answerText.textContent = result.message;
      answerPanel.dataset.state = result.status;
      renderRetrieval(result.results);
    }

    function submitQuestion(query) {
      const safeQuery = String(query == null ? '' : query).slice(0, 500).trim();
      input.value = safeQuery;
      resultQuestion.textContent = safeQuery || '未輸入問題';
      statusText.dataset.status = 'idle';
      statusText.textContent = '正在檢索規則…';
      answerText.textContent = '系統正在比較知識庫中的規則片段。';
      askButton.disabled = true;

      const result = engine.answer(safeQuery);
      renderAnswer(result);
      setSelectedQuestion(safeQuery);
      askButton.disabled = false;

      if (typeof resultQuestion.focus === 'function') {
        resultQuestion.focus({ preventScroll: true });
      }
      return result;
    }

    function renderCommonQuestions() {
      commonHost.replaceChildren();
      for (const question of data.commonQuestions) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'common-question';
        button.dataset.question = question;
        button.setAttribute('aria-pressed', 'false');
        button.textContent = question;
        button.addEventListener('click', function () {
          submitQuestion(question);
        });
        commonHost.appendChild(button);
      }
    }

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      submitQuestion(input.value);
    });

    input.addEventListener('keydown', function (event) {
      if (event.isComposing) return;
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        submitQuestion(input.value);
      }
    });

    input.addEventListener('input', function () {
      if (input.value.length > MAX_QUERY_LENGTH) input.value = input.value.slice(0, MAX_QUERY_LENGTH);
    });

    renderCommonQuestions();
    submitQuestion('玩家死亡後怎麼復活？');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
}());

