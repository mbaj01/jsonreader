// Dark mode toggle logic
document.addEventListener('DOMContentLoaded', function () {
  const toggle = document.getElementById('darkModeToggle');
  if (!toggle) return;
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const saved = localStorage.getItem('theme');
  const root = document.documentElement;
  function setMode(mode) {
    if (mode === 'dark') {
      root.classList.add('dark');
      root.classList.remove('light');
      toggle.setAttribute('aria-pressed', 'true');
      toggle.textContent = '☀️ Light Mode';
    } else {
      root.classList.remove('dark');
      root.classList.add('light');
      toggle.setAttribute('aria-pressed', 'false');
      toggle.textContent = '🌙 Dark Mode';
    }
  }
  if (saved === 'dark' || (!saved && prefersDark)) {
    setMode('dark');
  } else {
    setMode('light');
  }
  toggle.addEventListener('click', function () {
    const isDark = !root.classList.contains('dark');
    setMode(isDark ? 'dark' : 'light');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
  });
});
const statusEl = document.getElementById('status');
const fileInput = document.getElementById('fileInput');
const dropZone = document.getElementById('dropZone');
const summaryEl = document.getElementById('summary');
const insightsEl = document.getElementById('insights');
const structuredEl = document.getElementById('structuredData');

init();

function init() {
  fileInput.addEventListener('change', onFileSelected);

  dropZone.addEventListener('dragover', (event) => {
    event.preventDefault();
    dropZone.classList.add('dragging');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragging');
  });

  dropZone.addEventListener('drop', async (event) => {
    event.preventDefault();
    dropZone.classList.remove('dragging');
    const file = event.dataTransfer.files && event.dataTransfer.files[0];
    if (file) {
      await readFileFromInput(file);
    }
  });

  setStatus('Choose or drop a JSON file to begin.', 'ok');
}

async function onFileSelected(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) {
    return;
  }
  await readFileFromInput(file);
}

async function readFileFromInput(file) {
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    renderDashboard(data, file.name);
  } catch (error) {
    setStatus('Invalid JSON file: ' + error.message, 'error');
  }
}

function renderDashboard(data, sourceLabel) {
  setStatus('Loaded: ' + sourceLabel, 'ok');

  renderSummary(data);
  renderInsights(data);
  renderStructured(data);
}

function setStatus(message, type) {
  statusEl.textContent = message;
  statusEl.classList.remove('ok', 'error');
  statusEl.classList.add(type);
}

function renderSummary(data) {
  summaryEl.innerHTML = '';

  const appVersions = data.ApplicationVersions || {};
  const appEntries = Object.values(appVersions).filter((v) => typeof v === 'object');
  const appFound = appEntries.filter((v) => v.Found === true).length;

  const plugins = data.DllAndDriver?.ApoTunePlugins?.Dlls || [];
  const servers = data.NetworkDiagnostics?.ExternalServers || [];
  const reachablePings = servers.filter((s) => s.Ping && s.Ping.Reachable).length;

  const cards = [
    ['Report Generated', safeString(data.ReportGeneratedAt)],
    ['Machine', safeString(data.Machine || data.SystemInfo?.MachineName)],
    ['ApoTune Version', safeString(data.ApplicationVersions?.ApoTune?.Version)],
    ['Detected Apps', `${appFound} / ${appEntries.length}`],
    ['Plugin DLLs', String(plugins.length)],
    ['Reachable Servers', `${reachablePings} / ${servers.length}`],
    ['Available Memory (GB)', safeNumber(data.SystemInfo?.AvailableMemoryGB)],
    ['Diagnostics Complete', String(Boolean(data.DiagnosticsComplete))]
  ];

  cards.forEach(([title, value], i) => {
    const card = document.createElement('article');
    card.className = 'card';
    card.style.animationDelay = `${i * 55}ms`;
    card.innerHTML = `<h3>${escapeHtml(title)}</h3><p>${escapeHtml(value)}</p>`;
    summaryEl.appendChild(card);
  });
}

function renderInsights(data) {
  insightsEl.innerHTML = '';

  const insights = [];
  const totalMemory = Number(data.SystemInfo?.TotalMemoryGB || 0);
  const availableMemory = Number(data.SystemInfo?.AvailableMemoryGB || 0);
  if (totalMemory > 0) {
    const usagePct = ((totalMemory - availableMemory) / totalMemory) * 100;
    insights.push(`Memory usage is currently around ${usagePct.toFixed(1)}%.`);
  }

  const appEvents = data.EventViewerErrors?.ApplicationEventErrors || [];
  if (Array.isArray(appEvents) && appEvents.length === 0) {
    insights.push('No application event errors were included in the report.');
  }

  const processWhitelist = data.NetworkDiagnostics?.ProcessWhitelist;
  if (processWhitelist) {
    const existing = Number(processWhitelist.ExistingProcesses || 0);
    const total = Number(processWhitelist.TotalProcesses || 0);
    insights.push(`Process whitelist present files: ${existing} of ${total}.`);
  }

  const externalServers = data.NetworkDiagnostics?.ExternalServers || [];
  const blocked = externalServers.filter((s) => {
    const ports = s.Ports || {};
    const values = Object.values(ports);
    return values.length > 0 && values.every((isOpen) => isOpen === false);
  });
  if (blocked.length > 0) {
    insights.push(`${blocked.length} external server entries have all tested ports closed.`);
  }

  if (insights.length === 0) {
    insights.push('No quick insights available for this file.');
  }

  insights.forEach((text) => {
    const div = document.createElement('div');
    div.className = 'insight';
    div.textContent = text;
    insightsEl.appendChild(div);
  });
}

function renderStructured(data) {
  structuredEl.innerHTML = '';

  const preferredOrder = [
    'SystemInfo',
    'ApplicationVersions',
    'FileSystem',
    'DllAndDriver',
    'NetworkDiagnostics',
    'Timings'
  ];

  const keys = Object.keys(data);
  const ordered = [
    ...preferredOrder.filter((k) => keys.includes(k)),
    ...keys.filter((k) => !preferredOrder.includes(k))
  ];

  ordered.forEach((key) => {
    const node = createNode(key, data[key], 0);
    structuredEl.appendChild(node);
  });
}

function createNode(label, value, level) {
  const details = document.createElement('details');
  if (level < 1) {
    details.open = true;
  }

  const summary = document.createElement('summary');
  const valueMeta = getValueMeta(value);
  summary.innerHTML = `${escapeHtml(label)} <span class="summary-meta">${escapeHtml(valueMeta)}</span>`;

  const body = document.createElement('div');
  body.className = 'node-body';

  if (Array.isArray(value)) {
    if (value.length === 0) {
      body.innerHTML = '<div class="array-meta">Empty array</div>';
    } else if (value.every((item) => isPlainObject(item))) {
      body.appendChild(renderArrayOfObjects(value, label));
    } else {
      const list = document.createElement('ol');
      value.forEach((item) => {
        const li = document.createElement('li');
        if (isPrimitive(item)) {
          li.textContent = formatDisplayValue(item);
        } else {
          li.appendChild(createNode('item', item, level + 1));
        }
        list.appendChild(li);
      });
      body.appendChild(list);
    }
  } else if (isPlainObject(value)) {
    const primitiveTable = document.createElement('table');
    primitiveTable.className = 'kv';

    const entries = Object.entries(value);
    const primitiveEntries = entries.filter(([, v]) => isPrimitive(v));
    const complexEntries = entries.filter(([, v]) => !isPrimitive(v));

    if (primitiveEntries.length > 0) {
      const tbody = document.createElement('tbody');
      primitiveEntries.forEach(([k, v]) => {
        const row = document.createElement('tr');
        row.innerHTML = `<th>${escapeHtml(k)}</th><td>${escapeHtml(formatDisplayValue(v))}</td>`;
        tbody.appendChild(row);
      });
      primitiveTable.appendChild(tbody);
      body.appendChild(primitiveTable);
    }

    complexEntries.forEach(([k, v]) => {
      body.appendChild(createNode(k, v, level + 1));
    });
  } else {
    body.textContent = formatDisplayValue(value);
  }

  details.appendChild(summary);
  details.appendChild(body);
  return details;
}

function renderArrayOfObjects(items, fieldName) {
  const table = document.createElement('table');
  table.className = 'kv';

  let keys = uniqueKeys(items);

  if (fieldName === 'Dlls') {
    const priorityKeys = ['Name', 'PluginId', 'PluginName', 'VersionFromFilename'];
    const prioritized = priorityKeys.filter((k) => keys.includes(k));
    const remaining = keys.filter((k) => !priorityKeys.includes(k));
    keys = [...prioritized, ...remaining];
  }

  keys = keys.slice(0, 8);
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  keys.forEach((k) => {
    const th = document.createElement('th');
    th.textContent = k;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  items.slice(0, 100).forEach((item) => {
    const row = document.createElement('tr');
    keys.forEach((k) => {
      const td = document.createElement('td');
      const value = item[k];
      if (isPrimitive(value)) {
        td.textContent = formatDisplayValue(value);
      } else {
        td.appendChild(renderComplexCellValue(value, k));
      }
      row.appendChild(td);
    });
    tbody.appendChild(row);
  });

  table.appendChild(tbody);

  if (items.length > 100) {
    const wrapper = document.createElement('div');
    wrapper.appendChild(table);

    const note = document.createElement('div');
    note.className = 'array-meta';
    note.textContent = `Showing first 100 rows of ${items.length}.`;
    wrapper.appendChild(note);
    return wrapper;
  }

  return table;
}

function uniqueKeys(items) {
  const set = new Set();
  items.forEach((item) => {
    Object.keys(item).forEach((key) => set.add(key));
  });
  return Array.from(set);
}

function renderComplexCellValue(value, fieldName) {
  if (Array.isArray(value)) {
    const container = document.createElement('div');
    container.className = 'subfields';
    if (value.length === 0) {
      container.textContent = '[]';
      return container;
    }

    value.forEach((item, index) => {
      const line = document.createElement('div');
      line.className = 'subfield';
      if (isPrimitive(item)) {
        line.innerHTML = `<span class="subfield-key">[${index}]</span> <span class="subfield-value">${escapeHtml(formatDisplayValue(item))}</span>`;
      } else if (isPlainObject(item)) {
        line.innerHTML = `<span class="subfield-key">[${index}]</span>`;
        line.appendChild(renderObjectSubfields(item));
      } else {
        line.innerHTML = `<span class="subfield-key">[${index}]</span> <span class="subfield-value">${escapeHtml(String(item))}</span>`;
      }
      container.appendChild(line);
    });

    return container;
  }

  if (isPlainObject(value)) {
    if (fieldName === 'Ping') {
      return renderPingSubfields(value);
    }

    if (fieldName === 'Ports') {
      return renderPortsSubfields(value);
    }

    return renderObjectSubfields(value);
  }

  const fallback = document.createElement('div');
  fallback.textContent = String(value);
  return fallback;
}

function renderPingSubfields(ping) {
  const orderedKeys = ['Reachable', 'RoundtripMs', 'Status'];
  const orderedEntries = [
    ...orderedKeys
      .filter((key) => Object.prototype.hasOwnProperty.call(ping, key) && ping[key] !== null)
      .map((key) => [key, ping[key]]),
    ...Object.entries(ping).filter(([key, value]) => !orderedKeys.includes(key) && value !== null)
  ];

  const container = document.createElement('div');
  container.className = 'subfields';

  orderedEntries.forEach(([key, value]) => {
    const line = document.createElement('div');
    line.className = 'subfield';

    let formattedValue = formatDisplayValue(value);
    if (key === 'Reachable' && typeof value === 'boolean') {
      formattedValue = value ? 'Yes' : 'No';
    }
    if (key === 'RoundtripMs' && typeof value === 'number') {
      formattedValue = `${value} ms`;
    }

    line.innerHTML = `<span class="subfield-key">${escapeHtml(key)}</span>: <span class="subfield-value">${escapeHtml(formattedValue)}</span>`;
    container.appendChild(line);
  });

  return container;
}

function renderPortsSubfields(ports) {
  const entries = Object.entries(ports).sort(([a], [b]) => {
    const aNum = Number(a);
    const bNum = Number(b);
    const aIsNum = Number.isFinite(aNum);
    const bIsNum = Number.isFinite(bNum);

    if (aIsNum && bIsNum) {
      return aNum - bNum;
    }
    if (aIsNum) {
      return -1;
    }
    if (bIsNum) {
      return 1;
    }
    return a.localeCompare(b);
  });

  const container = document.createElement('div');
  container.className = 'subfields';

  entries.forEach(([port, isOpen]) => {
    const line = document.createElement('div');
    line.className = 'subfield';
    const status = isOpen === true ? 'Open' : isOpen === false ? 'Closed' : formatDisplayValue(isOpen);

    line.innerHTML = `<span class="subfield-key">Port ${escapeHtml(port)}</span>: <span class="subfield-value">${escapeHtml(status)}</span>`;
    container.appendChild(line);
  });

  return container;
}

function renderObjectSubfields(obj) {
  const container = document.createElement('div');
  container.className = 'subfields';

  Object.entries(obj).forEach(([key, nestedValue]) => {
    const line = document.createElement('div');
    line.className = 'subfield';

    if (isPrimitive(nestedValue)) {
      line.innerHTML = `<span class="subfield-key">${escapeHtml(key)}</span>: <span class="subfield-value">${escapeHtml(formatDisplayValue(nestedValue))}</span>`;
    } else if (isPlainObject(nestedValue)) {
      line.innerHTML = `<span class="subfield-key">${escapeHtml(key)}</span>:`;
      line.appendChild(renderComplexCellValue(nestedValue, key));
    } else if (Array.isArray(nestedValue)) {
      line.innerHTML = `<span class="subfield-key">${escapeHtml(key)}</span>:`;
      line.appendChild(renderComplexCellValue(nestedValue, key));
    } else {
      line.innerHTML = `<span class="subfield-key">${escapeHtml(key)}</span>: <span class="subfield-value">${escapeHtml(String(nestedValue))}</span>`;
    }

    container.appendChild(line);
  });

  return container;
}

function getValueMeta(value) {
  if (Array.isArray(value)) {
    return `array(${value.length})`;
  }
  if (isPlainObject(value)) {
    return `object(${Object.keys(value).length})`;
  }
  return typeof value;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isPrimitive(value) {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

function safeString(value) {
  if (value === null || value === undefined || value === '') {
    return 'N/A';
  }
  return formatDisplayValue(value);
}

function safeNumber(value) {
  if (typeof value === 'number') {
    return value.toFixed(2);
  }
  return 'N/A';
}

function formatDisplayValue(value) {
  if (value === null || value === undefined) {
    return String(value);
  }

  if (typeof value === 'string' && isIsoDateTimeString(value)) {
    return formatIsoDateTime(value);
  }

  return String(value);
}

function isIsoDateTimeString(value) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?(?:Z|[+-]\d{2}:\d{2})$/.test(value);
}

function formatIsoDateTime(isoText) {
  const parsed = new Date(isoText);
  if (Number.isNaN(parsed.getTime())) {
    return isoText;
  }

  const datePart = parsed.toLocaleDateString(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });

  const timePart = parsed.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

  return `${datePart} ${timePart}`;
}

function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
