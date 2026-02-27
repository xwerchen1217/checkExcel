const PAGE_SIZE = 100;
const IMG_PREFIX = 'http://img20.360buyimg.com/ling/';

const state = {
  fileName: '',
  headers: [],
  rows: [],
  sessionId: '',
  reviews: {},
  page: 1,
};

const fileInput = document.getElementById('fileInput');
const uploadBtn = document.getElementById('uploadBtn');
const exportBtn = document.getElementById('exportBtn');
const dataTable = document.getElementById('dataTable');
const tableCard = document.getElementById('tableCard');
const totalRowsEl = document.getElementById('totalRows');
const currentPageEl = document.getElementById('currentPage');
const pageInfoEl = document.getElementById('pageInfo');
const fileNameEl = document.getElementById('fileName');
const sessionIdEl = document.getElementById('sessionId');
const saveStatusEl = document.getElementById('saveStatus');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');

function setSaveStatus(text, color = '#6b7280') {
  saveStatusEl.textContent = text;
  saveStatusEl.style.color = color;
}

function getImagePathFromRow(row) {
  for (const cell of row) {
    if (typeof cell !== 'string') continue;
    const value = cell.trim();
    if (/^https?:\/\//i.test(value) && /\.(jpg|jpeg|png|webp)$/i.test(value)) return value;
    if (/^jfs\//i.test(value) && /\.(jpg|jpeg|png|webp)$/i.test(value)) return IMG_PREFIX + value;
  }
  return '';
}

function safeText(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function totalPages() {
  return Math.max(1, Math.ceil(state.rows.length / PAGE_SIZE));
}

function renderTable() {
  if (!state.rows.length) {
    tableCard.classList.add('hidden');
    return;
  }

  tableCard.classList.remove('hidden');
  totalRowsEl.textContent = String(state.rows.length);
  currentPageEl.textContent = String(state.page);
  fileNameEl.textContent = state.fileName || '-';
  sessionIdEl.textContent = state.sessionId || '-';

  const pages = totalPages();
  if (state.page > pages) state.page = pages;

  const start = (state.page - 1) * PAGE_SIZE;
  const end = Math.min(start + PAGE_SIZE, state.rows.length);
  const pageRows = state.rows.slice(start, end);

  let html = '<thead><tr>';
  html += '<th>#</th>';
  html += '<th>图片预览</th>';
  for (const h of state.headers) {
    html += `<th>${safeText(h)}</th>`;
  }
  html += '<th>审核状态</th><th>备注</th>';
  html += '</tr></thead><tbody>';

  pageRows.forEach((row, i) => {
    const rowIndex = start + i;
    const review = state.reviews[String(rowIndex)] || { status: '待处理', note: '' };
    const imgSrc = getImagePathFromRow(row);

    html += '<tr>';
    html += `<td>${rowIndex + 1}</td>`;
    if (imgSrc) {
      html += `<td><a href="${safeText(imgSrc)}" target="_blank" rel="noopener"><img class="preview" src="${safeText(imgSrc)}" alt="商品图" /></a></td>`;
    } else {
      html += '<td>-</td>';
    }

    for (const cell of row) {
      const text = typeof cell === 'string' ? cell : JSON.stringify(cell ?? '');
      html += `<td>${safeText(text)}</td>`;
    }

    html += '<td>';
    html += `<select data-row-index="${rowIndex}" class="status-select">`;
    for (const status of ['待处理', '通过', '驳回']) {
      const selected = review.status === status ? 'selected' : '';
      html += `<option value="${status}" ${selected}>${status}</option>`;
    }
    html += '</select>';
    html += '</td>';

    html += `<td><input class="note-input" data-row-index="${rowIndex}" value="${safeText(review.note || '')}" placeholder="填写备注" /></td>`;
    html += '</tr>';
  });

  html += '</tbody>';
  dataTable.innerHTML = html;

  pageInfoEl.textContent = `第 ${state.page} / ${pages} 页`;
  prevBtn.disabled = state.page <= 1;
  nextBtn.disabled = state.page >= pages;
}

async function parseFile(file) {
  const arrayBuffer = await file.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: 'array' });
  const firstSheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[firstSheetName];
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  if (!matrix.length) {
    throw new Error('文件没有可读取的数据');
  }

  const headers = matrix[0].map((h, i) => String(h || `字段${i + 1}`));
  const rows = matrix.slice(1).map((r) => {
    const row = [...r];
    while (row.length < headers.length) row.push('');
    return row.slice(0, headers.length);
  });

  return { headers, rows };
}

async function createSession(fileName, headers, rows) {
  const res = await fetch('/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName, headers, rows }),
  });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || '创建会话失败');
  }
  return res.json();
}

async function saveReview(rowIndex) {
  if (!state.sessionId) return;
  const review = state.reviews[String(rowIndex)] || { status: '待处理', note: '' };
  const res = await fetch(`/api/sessions/${state.sessionId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rowIndex, status: review.status, note: review.note }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || '保存失败');
  }
}

fileInput.addEventListener('change', () => {
  uploadBtn.disabled = !fileInput.files?.length;
});

uploadBtn.addEventListener('click', async () => {
  const file = fileInput.files?.[0];
  if (!file) return;

  try {
    setSaveStatus('正在解析文件...');
    const { headers, rows } = await parseFile(file);

    state.fileName = file.name;
    state.headers = headers;
    state.rows = rows;
    state.reviews = {};
    state.page = 1;

    setSaveStatus('正在创建后台会话...');
    const session = await createSession(file.name, headers, rows);
    state.sessionId = session.id;

    exportBtn.disabled = false;
    renderTable();
    setSaveStatus('会话已创建，可开始审核', '#16a34a');
  } catch (err) {
    console.error(err);
    setSaveStatus(err.message || '处理失败', '#dc2626');
  }
});

dataTable.addEventListener('change', async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;

  const rowIndex = Number(target.getAttribute('data-row-index'));
  if (!Number.isInteger(rowIndex)) return;

  if (target.classList.contains('status-select')) {
    state.reviews[String(rowIndex)] = {
      ...(state.reviews[String(rowIndex)] || {}),
      status: target.value,
      note: state.reviews[String(rowIndex)]?.note || '',
    };

    try {
      setSaveStatus(`保存第 ${rowIndex + 1} 条...`);
      await saveReview(rowIndex);
      setSaveStatus(`已保存第 ${rowIndex + 1} 条`, '#16a34a');
    } catch (err) {
      setSaveStatus(err.message || '保存失败', '#dc2626');
    }
  }
});

dataTable.addEventListener('blur', async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  if (!target.classList.contains('note-input')) return;

  const rowIndex = Number(target.getAttribute('data-row-index'));
  if (!Number.isInteger(rowIndex)) return;

  state.reviews[String(rowIndex)] = {
    ...(state.reviews[String(rowIndex)] || {}),
    status: state.reviews[String(rowIndex)]?.status || '待处理',
    note: target.value || '',
  };

  try {
    setSaveStatus(`保存第 ${rowIndex + 1} 条备注...`);
    await saveReview(rowIndex);
    setSaveStatus(`第 ${rowIndex + 1} 条备注已保存`, '#16a34a');
  } catch (err) {
    setSaveStatus(err.message || '保存失败', '#dc2626');
  }
}, true);

prevBtn.addEventListener('click', () => {
  if (state.page > 1) {
    state.page -= 1;
    renderTable();
  }
});

nextBtn.addEventListener('click', () => {
  if (state.page < totalPages()) {
    state.page += 1;
    renderTable();
  }
});

exportBtn.addEventListener('click', () => {
  if (!state.sessionId) return;
  window.location.href = `/api/sessions/${state.sessionId}/export`;
});
