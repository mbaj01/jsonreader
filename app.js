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
let currentFileType = null;
let currentDymoFilters = { source: null, level: null };

// Parser registry: add new parsers here to detect and normalize known JSON shapes
const parserRegistry = [
  {
    name: 'DiagnosticReport',
    match: (raw, fileName) => {
      return raw && typeof raw === 'object' && (raw.ReportGeneratedAt || raw.DiagnosticsComplete || raw.SystemInfo);
    },
    normalize: (raw) => ({ typeMeta: { detected: 'DiagnosticReport' }, data: raw })
  },
  {
    name: 'DymoLog',
    match: (raw, fileName) => {
      // Detect NDJSON-style or array logs produced by DymoTestTool: entries with @t/@mt keys
      const looksLikeEntry = (it) => it && typeof it === 'object' && ('@t' in it || '@mt' in it || 'SourceContext' in it);
      if (Array.isArray(raw) && raw.length > 0 && looksLikeEntry(raw[0])) return true;
      if (looksLikeEntry(raw)) return true;
      // also consider filename hints
      if (typeof fileName === 'string' && /dymo/i.test(fileName)) return true;
      return false;
    },
    normalize: (raw) => {
      const entries = Array.isArray(raw) ? raw : [raw];
      // filter out pure-separator lines like "=====" or "-----" which are visual only
      const isSeparator = (e) => {
        const mt = e && (e['@mt'] || e.Message || e.MessageTemplate || e['@m']);
        if (!mt || typeof mt !== 'string') return false;
        return /^\s*[-=]{4,}\s*$/.test(mt);
      };

      const filtered = entries.filter((e) => !isSeparator(e));
      const summary = { total: entries.length, filteredOut: entries.length - filtered.length, bySource: {}, byLevel: {}, byMessage: {} };
      filtered.forEach((e) => {
        const src = e.SourceContext || e.Source || 'unknown';
        summary.bySource[src] = (summary.bySource[src] || 0) + 1;
        const lvl = String(e['@l'] || e.Level || 'info');
        const lvlKey = lvl || 'info';
        summary.byLevel[lvlKey] = (summary.byLevel[lvlKey] || 0) + 1;
        const mt = e['@mt'] || e.MessageTemplate || e['@m'] || e.Message || null;
        if (mt) summary.byMessage[mt] = (summary.byMessage[mt] || 0) + 1;
        // try to parse embedded JSON content strings e.g. Content
        if (typeof e.Content === 'string' && e.Content.trim().startsWith('{')) {
          try {
            e.ContentParsed = JSON.parse(e.Content);
          } catch (err) {
            // ignore
          }
        }
      });

      return {
        typeMeta: { detected: 'DymoLog' },
        data: { DymoLogEntries: filtered, Summary: summary }
      };
    }
  },
  {
    name: 'ArrayOfObjects',
    match: (raw) => Array.isArray(raw) && raw.length > 0 && raw.every((it) => isPlainObject(it)),
    normalize: (raw) => ({ typeMeta: { detected: 'ArrayOfObjects' }, data: { Items: raw } })
  },
  {
    name: 'GenericObject',
    match: (raw) => raw && typeof raw === 'object',
    normalize: (raw) => ({ typeMeta: { detected: 'GenericObject' }, data: raw })
  }
];

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
    let raw;
    try {
      raw = JSON.parse(text);
    } catch (jsonErr) {
      // attempt to parse NDJSON (newline-delimited JSON) as a fallback
      const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      if (lines.length > 0) {
        const parsedLines = [];
        let allParsed = true;
        for (const line of lines) {
          try {
            parsedLines.push(JSON.parse(line));
          } catch (e) {
            allParsed = false;
            break;
          }
        }
        if (allParsed) {
          raw = parsedLines;
        } else {
          throw jsonErr;
        }
      } else {
        throw jsonErr;
      }
    }
    const parsed = parseFile(raw, file.name);
    renderDashboard(parsed.data, file.name, parsed.typeMeta && parsed.typeMeta.detected);
  } catch (error) {
    setStatus('Invalid JSON file: ' + error.message, 'error');
  }
}

function renderDashboard(data, sourceLabel) {
  // backward-compatible call: allow optional fileType
  const fileType = arguments.length > 2 ? arguments[2] : undefined;
  currentFileType = fileType || null;
  setStatus('Loaded: ' + sourceLabel + (fileType ? ` (${fileType})` : ''), 'ok');

  // Only show the diagnostic summary and quick insights for known DiagnosticReport files
  if (fileType === 'DiagnosticReport') {
    renderSummary(data);
    renderInsights(data);
  } else if (fileType === 'DymoLog') {
    renderDymoSummary(data);
  } else {
    // clear the UI regions to avoid showing irrelevant cards/insights
    summaryEl.innerHTML = '';
    insightsEl.innerHTML = '';
  }

  renderStructured(data);
}

function parseFile(raw, fileName) {
  for (const p of parserRegistry) {
    try {
      if (typeof p.match === 'function' && p.match(raw, fileName)) {
        return p.normalize(raw, fileName) || { typeMeta: { detected: p.name }, data: raw };
      }
    } catch (e) {
      // ignore matcher errors and try next
    }
  }
  return { typeMeta: { detected: 'Unknown' }, data: raw };
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

function renderDymoSummary(data) {
  summaryEl.innerHTML = '';
  insightsEl.innerHTML = '';

  const entries = data.DymoLogEntries || [];
  const summary = data.Summary || {};

  const total = summary.total || entries.length;
  const filteredOut = summary.filteredOut || 0;
  const distinctSources = Object.keys(summary.bySource || {}).length;
  const errorCount = Object.entries(summary.byLevel || {}).reduce((s, [k, v]) => (k && k.toLowerCase() === 'error' ? s + v : s), 0);

  const cards = [
    ['Total Entries', String(total)],
    ['Filtered Separators', String(filteredOut)],
    ['Errors', String(errorCount)],
    ['Distinct Sources', String(distinctSources)]
  ];

  cards.forEach(([title, value], i) => {
    const card = document.createElement('article');
    card.className = 'card';
    card.style.animationDelay = `${i * 55}ms`;
    card.innerHTML = `<h3>${escapeHtml(title)}</h3><p>${escapeHtml(value)}</p>`;
    summaryEl.appendChild(card);
  });

  // top 5 sources
  const topSources = Object.entries(summary.bySource || {}).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const topMessages = Object.entries(summary.byMessage || {}).sort((a, b) => b[1] - a[1]).slice(0, 5);

  const sPanel = document.createElement('div');
  sPanel.className = 'panel';
  const sHeader = document.createElement('h2');
  sHeader.textContent = 'Dymo Log Summary';
  sPanel.appendChild(sHeader);

  // Render the full Summary object (compact structured view) into insights
  if (summary && typeof summary === 'object') {
    const summaryNode = createNode('Summary', summary, 0);
    summaryNode.style.margin = '0.6rem 0 0.8rem';
    sPanel.appendChild(summaryNode);
  }

  // Add simple filters: Source and Level
  const filtersRow = document.createElement('div');
  filtersRow.style.display = 'flex';
  filtersRow.style.gap = '0.6rem';
  filtersRow.style.alignItems = 'center';
  filtersRow.style.marginTop = '0.6rem';

  const makeSelect = (labelText, options) => {
    const wrapper = document.createElement('label');
    wrapper.style.display = 'flex';
    wrapper.style.flexDirection = 'column';
    wrapper.style.fontSize = '0.9rem';
    const label = document.createElement('span');
    label.textContent = labelText;
    const sel = document.createElement('select');
    sel.style.padding = '0.35rem';
    sel.style.borderRadius = '6px';
    sel.style.border = '1px solid var(--border)';
    const allOpt = document.createElement('option');
    allOpt.value = '';
    allOpt.textContent = 'All';
    sel.appendChild(allOpt);
    options.forEach((o) => {
      const opt = document.createElement('option');
      if (typeof o === 'object' && o !== null && 'value' in o) {
        opt.value = String(o.value);
        opt.textContent = String(o.label || o.value);
      } else {
        const val = String(o).toLowerCase().trim();
        opt.value = val;
        opt.textContent = String(o);
      }
      sel.appendChild(opt);
    });
    wrapper.appendChild(label);
    wrapper.appendChild(sel);
    return { wrapper, select: sel };
  };

  const sourceKeys = Object.keys(summary.bySource || {}).sort();
  const levelKeys = Object.keys(summary.byLevel || {}).sort();
  const sourceSel = makeSelect('Filter by Source', sourceKeys);
  const levelSel = makeSelect('Filter by Level', levelKeys.map((k) => ({ label: k, value: normalizeLevelKey(k) })));
  const clearBtn = document.createElement('button');
  clearBtn.className = 'btn';
  clearBtn.textContent = 'Clear filters';
  clearBtn.addEventListener('click', () => {
    sourceSel.select.value = '';
    levelSel.select.value = '';
    currentDymoFilters.source = null;
    currentDymoFilters.level = null;
    applyDymoFilters();
  });

  sourceSel.select.addEventListener('change', (e) => {
    const v = e.target.value || null;
    currentDymoFilters.source = v;
    applyDymoFilters();
  });
  levelSel.select.addEventListener('change', (e) => {
    const v = e.target.value || null;
    currentDymoFilters.level = v;
    applyDymoFilters();
  });

  filtersRow.appendChild(sourceSel.wrapper);
  filtersRow.appendChild(levelSel.wrapper);
  filtersRow.appendChild(clearBtn);
  sPanel.appendChild(filtersRow);


  // Top Sources removed per user request — Summary object retained
  insightsEl.appendChild(sPanel);
  // Ensure the summary is visible at the top of the page
  try {
    sPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) {}
}

function createExpandableText(text, maxLen = 120) {
  const container = document.createElement('div');
  const short = String(text || '');
  if (short.length <= maxLen) {
    const span = document.createElement('span');
    span.textContent = short;
    container.appendChild(span);
    return container;
  }

  const truncated = document.createElement('span');
  truncated.className = 'truncated';
  truncated.textContent = short.slice(0, maxLen) + '…';

  const full = document.createElement('span');
  full.style.display = 'none';
  full.textContent = short;

  const btn = document.createElement('button');
  btn.className = 'expand-btn';
  btn.textContent = 'Show';
  btn.addEventListener('click', () => {
    const isHidden = full.style.display === 'none';
    full.style.display = isHidden ? '' : 'none';
    truncated.style.display = isHidden ? 'none' : '';
    btn.textContent = isHidden ? 'Hide' : 'Show';
  });

  container.appendChild(truncated);
  container.appendChild(full);
  container.appendChild(btn);
  return container;
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
    // Hide the Dymo-generated Summary node from the structured view (we show it in Quick Insights)
    if (currentFileType === 'DymoLog' && key === 'Summary') return;
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
      const wrap = document.createElement('div');
      wrap.className = 'table-wrap';
      wrap.appendChild(primitiveTable);
      body.appendChild(wrap);
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
  // First, cluster items by their set of keys (shape). This lets us render separate
  // tables for rows that share similar fields (e.g., network checks vs printer checks).
  const clusters = Object.create(null);
  items.forEach((item) => {
    const keys = Object.keys(item).sort();
    const sig = keys.join('|') || '__empty__';
    if (!clusters[sig]) clusters[sig] = { keys: keys, items: [] };
    clusters[sig].items.push(item);
  });

  // Helper to render a single table for a specific set of keys
  function renderTableForKeys(keys, rows) {
    const table = document.createElement('table');
    table.className = 'kv';

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
    (rows || items).slice(0, 100).forEach((item, idx) => {
      const row = document.createElement('tr');
      // If rendering Dymo log entries, annotate rows with the message template for linking/filtering
      try {
        if (fieldName === 'DymoLogEntries') {
          const mt = item['@mt'] || item.MessageTemplate || item['@m'] || item.Message || '';
          if (mt) row.dataset.msgTemplate = String(mt);
          const src = item.SourceContext || item.Source || '';
          if (src) row.dataset.source = String(src).toLowerCase().trim();
          const lvl = item['@l'] || item.Level || '';
          if (lvl) row.dataset.level = normalizeLevelKey(lvl);
          row.id = `dymo-entry-${Math.random().toString(36).slice(2, 9)}`;
        }
      } catch (e) {
        // ignore
      }
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

    const wrap = document.createElement('div');
    wrap.className = 'table-wrap';
    wrap.appendChild(table);
    return wrap;
  }

  const sigs = Object.keys(clusters);
  if (sigs.length > 1) {
    const wrapper = document.createElement('div');
    wrapper.className = 'clusters';
    sigs.forEach((sig, idx) => {
      const c = clusters[sig];
      const section = document.createElement('section');
      section.className = 'cluster';

      const headerDiv = document.createElement('div');
      headerDiv.className = 'section-header';
      const h4 = document.createElement('h4');
      h4.textContent = `Group ${idx + 1} — ${c.items.length} rows — ${c.keys.length} cols`;
      const toggle = document.createElement('button');
      toggle.className = 'toggle-btn';
      toggle.textContent = 'Hide';
      toggle.addEventListener('click', () => {
        section.classList.toggle('collapsed');
        toggle.textContent = section.classList.contains('collapsed') ? 'Show' : 'Hide';
      });
      headerDiv.appendChild(h4);
      headerDiv.appendChild(toggle);
      section.appendChild(headerDiv);

      section.appendChild(renderTableForKeys(c.keys, c.items));
      wrapper.appendChild(section);
    });

    const note = document.createElement('div');
    note.className = 'array-meta';
    note.textContent = `Showing first 100 rows per group (total ${items.length}).`;
    wrapper.appendChild(note);
    return wrapper;
  }

  // Single cluster -> fall back to grouping by key prefix for readability when many columns
  const allKeys = uniqueKeys(items);

  function keyBase(key) {
    if (typeof key !== 'string') return 'other';
    if (key.startsWith('@')) return 'meta';
    const m = key.match(/^[a-zA-Z]+/);
    return m ? m[0].toLowerCase() : 'other';
  }

  function groupKeys(keys) {
    const map = Object.create(null);
    keys.forEach((k) => {
      const base = keyBase(k);
      if (!map[base]) map[base] = [];
      map[base].push(k);
    });
    return Object.entries(map).sort((a, b) => b[1].length - a[1].length);
  }

  if (fieldName === 'Dlls') {
    const priorityKeys = ['Name', 'PluginId', 'PluginName', 'VersionFromFilename'];
    const prioritized = priorityKeys.filter((k) => allKeys.includes(k));
    const remaining = allKeys.filter((k) => !priorityKeys.includes(k));
    const singleKeys = [...prioritized, ...remaining].slice(0, 8);
    if (allKeys.length <= 8) {
      return renderTableForKeys(singleKeys);
    }
  }

  if (allKeys.length <= 8) {
    return renderTableForKeys(allKeys.slice(0, 8));
  }

  const groups = groupKeys(allKeys);
  const wrapper = document.createElement('div');
  wrapper.className = 'grouped-tables';
  groups.forEach(([groupName, groupKeys]) => {
    const readable = groupName === 'meta' ? 'Meta' : groupName.charAt(0).toUpperCase() + groupName.slice(1);
    const section = document.createElement('section');
    section.className = 'group';

    const headerDiv = document.createElement('div');
    headerDiv.className = 'section-header';
    const h4 = document.createElement('h4');
    h4.textContent = `${readable} (${groupKeys.length} columns)`;
    const toggle = document.createElement('button');
    toggle.className = 'toggle-btn';
    toggle.textContent = 'Hide';
    toggle.addEventListener('click', () => {
      section.classList.toggle('collapsed');
      toggle.textContent = section.classList.contains('collapsed') ? 'Show' : 'Hide';
    });
    headerDiv.appendChild(h4);
    headerDiv.appendChild(toggle);
    section.appendChild(headerDiv);
    section.appendChild(renderTableForKeys(groupKeys.slice(0, 8)));
    wrapper.appendChild(section);
  });

  const note = document.createElement('div');
  note.className = 'array-meta';
  note.textContent = `Showing first 100 rows of ${items.length}. Groups collapsed to 8 columns each.`;
  wrapper.appendChild(note);
  return wrapper;
}

function applyDymoFilters() {
  const structured = document.getElementById('structuredData');
  if (!structured) return;
  const { source, level } = currentDymoFilters || {};
  const hasAnyFilter = Boolean(source || level);

  // If no filters, clear everything and show all groups
  if (!hasAnyFilter) {
    structured.querySelectorAll('tr.filtered-out').forEach((r) => r.classList.remove('filtered-out'));
    structured.querySelectorAll('.cluster, .group').forEach((s) => (s.style.display = ''));
    return;
  }

  // Process each table: filter tbody rows, then show/hide thead based on visible rows
  structured.querySelectorAll('table').forEach((table) => {
    const tbodyRows = Array.from(table.querySelectorAll('tbody tr'));
    let anyVisible = false;
    tbodyRows.forEach((r) => {
      const rowSource = r.dataset && r.dataset.source ? r.dataset.source : '';
      const rowLevel = r.dataset && r.dataset.level ? r.dataset.level : '';
      const isAnnotated = rowSource !== '' || rowLevel !== '' || (r.dataset && r.dataset.msgTemplate);

      let visible = true;
      if (!isAnnotated) visible = false;
      if (visible && source) visible = visible && rowSource === source;
      if (visible && level) {
        // special-case: when user selects 'info', show everything except warnings and errors
        if (level === 'info') {
          visible = visible && rowLevel !== 'warning' && rowLevel !== 'error';
        } else {
          visible = visible && rowLevel === level;
        }
      }

      if (visible) {
        r.classList.remove('filtered-out');
        anyVisible = true;
      } else {
        r.classList.add('filtered-out');
      }
    });

    // Show or hide the table header depending on whether any body rows are visible
    const thead = table.querySelector('thead');
    if (thead) {
      const headerRow = thead.querySelector('tr');
      if (headerRow) {
        if (anyVisible) headerRow.classList.remove('filtered-out'); else headerRow.classList.add('filtered-out');
      }
    }
  });

  // Hide groups/clusters that have no visible rows
  structured.querySelectorAll('.cluster, .group').forEach((s) => {
    const anyVisible = s.querySelectorAll('tbody tr:not(.filtered-out)').length > 0;
    s.style.display = anyVisible ? '' : 'none';
  });

  // Report how many matched (use only annotated rows as the denominator)
  const annotatedRows = Array.from(structured.querySelectorAll('tr')).filter((r) => {
    return !!(r.dataset && (r.dataset.source || r.dataset.level || r.dataset.msgTemplate));
  });
  const matched = Array.from(structured.querySelectorAll('tbody tr:not(.filtered-out)')).filter((r) => {
    return !!(r.dataset && (r.dataset.source || r.dataset.level || r.dataset.msgTemplate));
  }).length;
  setStatus(`Filtered: ${matched} matched (of ${annotatedRows.length} Dymo entries)`, 'ok');
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

function normalizeLevelKey(s) {
  if (!s) return '';
  const v = String(s).toLowerCase().trim();
  const map = {
    information: 'info',
    informational: 'info',
    info: 'info',
    warn: 'warning',
    warning: 'warning',
    error: 'error',
    err: 'error',
    critical: 'critical',
    fatal: 'critical'
  };
  return map[v] || v;
}

function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
