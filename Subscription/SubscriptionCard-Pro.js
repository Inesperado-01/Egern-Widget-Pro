/**
 * Egern Widget Pro · Subscription Card Pro
 * Required: url1
 * Optional: name1, refreshHours, ua, totalGB
 * Environment variable names are case-insensitive.
 */

const C = {
  bg: { light: '#FFFFFF', dark: '#050506' },
  text: { light: '#111114', dark: '#F7F7F8' },
  dim: { light: '#7B7B84', dark: '#96969F' },
  panel: { light: '#F5F5F7', dark: '#111114' },
  hairline: { light: '#E4E4E8', dark: '#242429' },
  track: { light: '#E8E8ED', dark: '#202025' },
  accent: { light: '#7446D8', dark: '#B765FF' },
  ok: { light: '#2F9E58', dark: '#9DFF32' },
  warn: { light: '#A06400', dark: '#FFBE3F' },
  fail: { light: '#D64545', dark: '#FF626A' }
};

const GAUGE_API = 'https://quickchart.io/chart';
const SHARED_CACHE_MS = 5 * 60 * 1000;

function env(ctx) {
  const values = {};
  for (const [key, value] of Object.entries(ctx.env || {})) values[String(key).toLowerCase()] = value;
  return (key, fallback = '') => {
    const value = values[String(key).toLowerCase()];
    return value == null || value === '' ? fallback : value;
  };
}

function numberEnv(ctx, key, fallback, min, max) {
  const value = Number(env(ctx)(key, fallback));
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function hashString(value) {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) hash = ((hash << 5) + hash) ^ value.charCodeAt(i);
  return (hash >>> 0).toString(36);
}

function readHeader(headers, name) {
  if (!headers) return '';
  if (typeof headers.get === 'function') return headers.get(name) || '';
  const target = String(name).toLowerCase();
  const key = Object.keys(headers).find(item => item.toLowerCase() === target);
  return key ? headers[key] : '';
}

function parseUserInfo(raw) {
  const values = {};
  String(raw || '').split(';').forEach(part => {
    const index = part.indexOf('=');
    if (index < 1) return;
    const key = part.slice(0, index).trim().toLowerCase();
    const value = Number(part.slice(index + 1).trim());
    if (Number.isFinite(value)) values[key] = value;
  });
  if (![values.upload, values.download, values.total].every(Number.isFinite)) return null;
  const upload = Math.max(0, values.upload);
  const download = Math.max(0, values.download);
  const total = Math.max(0, values.total);
  const used = upload + download;
  const unlimited = total === 0;
  const expire = Number(values.expire) || 0;
  return { upload, download, total, used, remaining: unlimited ? Infinity : Math.max(0, total - used), unlimited, expireAt: expire > 1e12 ? expire : expire * 1000 };
}

function unitBytes(value, unit) {
  const powers = { B: 0, KB: 1, MB: 2, GB: 3, TB: 4, PB: 5 };
  const power = powers[String(unit || '').toUpperCase()];
  return power == null ? null : Number(value) * (1024 ** power);
}

function parseBodyInfo(body) {
  const source = String(body || '').replace(/\\u([0-9a-fA-F]{4})/g, (_, code) => String.fromCharCode(parseInt(code, 16)));
  const remainingMatch = source.match(/剩余(?:流量)?[：:\s]*([0-9]+(?:\.[0-9]+)?)\s*(PB|TB|GB|MB|KB|B)/i);
  if (!remainingMatch) return null;
  const remaining = unitBytes(remainingMatch[1], remainingMatch[2]);
  const totalMatch = source.match(/(?:总(?:流量|量)|套餐流量)[：:\s]*([0-9]+(?:\.[0-9]+)?)\s*(PB|TB|GB|MB|KB|B)/i);
  const usedMatch = source.match(/已用(?:流量)?[：:\s]*([0-9]+(?:\.[0-9]+)?)\s*(PB|TB|GB|MB|KB|B)/i);
  const expireMatch = source.match(/(?:有效期|到期(?:时间)?|过期(?:时间)?)[：:\s]*([12]\d{3}[-/.]\d{1,2}[-/.]\d{1,2})/i);
  const total = totalMatch ? unitBytes(totalMatch[1], totalMatch[2]) : null;
  const explicitUsed = usedMatch ? unitBytes(usedMatch[1], usedMatch[2]) : null;
  const used = Number.isFinite(explicitUsed) ? explicitUsed : Number.isFinite(total) ? Math.max(0, total - remaining) : null;
  let expireAt = 0;
  if (expireMatch) {
    const parsed = new Date(`${expireMatch[1].replace(/[/.]/g, '-')}T23:59:59`);
    if (!Number.isNaN(parsed.getTime())) expireAt = parsed.getTime();
  }
  return { upload: null, download: null, total, used, remaining, unlimited: false, expireAt, partial: !Number.isFinite(total) };
}

function applyPlanTotal(ctx, traffic) {
  const totalGB = Number(env(ctx)('totalGB', 100));
  if (!traffic || Number.isFinite(traffic.total) || !Number.isFinite(totalGB) || totalGB <= 0) return traffic;
  const total = totalGB * (1024 ** 3);
  return { ...traffic, total, used: Math.max(0, total - traffic.remaining), partial: false, totalEstimated: true };
}

async function fetchSubscription(ctx, url) {
  const customUA = String(env(ctx)('ua', '')).trim();
  const userAgents = [...new Set([customUA, 'clash.meta', 'clash-verge/v2.2.3', 'Surge/5.0', 'Quantumult%20X/1.5.0'].filter(Boolean))];
  const extract = async response => {
    const headerData = parseUserInfo(readHeader(response?.headers, 'subscription-userinfo'));
    if (headerData) return headerData;
    try { return parseBodyInfo(await response.text()); } catch { return null; }
  };
  for (const userAgent of userAgents) {
    try {
      const response = await ctx.http.get(url, { timeout: 8000, redirect: 'manual', headers: { 'User-Agent': userAgent } });
      const direct = await extract(response);
      if (direct) return direct;
      const location = readHeader(response.headers, 'location');
      if (location && response.status >= 300 && response.status < 400) {
        const redirected = await ctx.http.get(new URL(location, url).toString(), { timeout: 8000, redirect: 'follow', headers: { 'User-Agent': userAgent } });
        const final = await extract(redirected);
        if (final) return final;
      }
    } catch {}
  }
  throw new Error('订阅未返回可识别的流量信息');
}

async function loadData(ctx) {
  const get = env(ctx);
  const url = String(get('url1', '')).trim();
  const name = String(get('name1', 'SUBSCRIPTION')).trim();
  if (!url) return { mode: 'setup', name };
  const key = `egern.widget.pro.subscription.classic.v1.${hashString(url)}`;
  const cached = ctx.storage?.getJSON(key);
  if (cached?.traffic && Date.now() - Number(cached.updatedAt || 0) < SHARED_CACHE_MS) return { ...cached, mode: 'live', name, shared: true };
  try {
    const traffic = applyPlanTotal(ctx, await fetchSubscription(ctx, url));
    const result = { mode: 'live', name, traffic, updatedAt: Date.now() };
    ctx.storage?.setJSON(key, result);
    return result;
  } catch (error) {
    if (cached?.traffic) return { ...cached, traffic: applyPlanTotal(ctx, cached.traffic), mode: 'stale', name, error: String(error?.message || error) };
    return { mode: 'error', name, error: String(error?.message || error || '加载失败') };
  }
}

function daysRemaining(expireAt) { return expireAt ? Math.ceil((expireAt - Date.now()) / 86400000) : null; }
function percentRemaining(traffic) { return traffic.unlimited || !Number.isFinite(traffic.total) || traffic.total <= 0 ? null : Math.max(0, Math.min(100, (traffic.remaining / traffic.total) * 100)); }
function usedPercentValue(traffic) { const remaining = percentRemaining(traffic); return remaining == null ? null : Math.max(0, Math.min(100, 100 - remaining)); }
function formatPercentValue(value) { if (!Number.isFinite(value)) return '--'; if (value === 0 || value === 100) return `${value.toFixed(0)}%`; return `${value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}%`; }

function statusOf(data) {
  if (data.mode === 'setup') return { label: 'SETUP', color: C.dim };
  if (data.mode === 'error') return { label: 'ERROR', color: C.fail };
  if (data.mode === 'stale') return { label: 'STALE', color: C.warn };
  const days = daysRemaining(data.traffic.expireAt);
  const ratio = percentRemaining(data.traffic);
  if ((!data.traffic.unlimited && data.traffic.remaining <= 0) || (days != null && days <= 0)) return { label: 'EXPIRED', color: C.fail };
  if ((ratio != null && ratio <= 20) || (days != null && days <= 7)) return { label: 'LOW', color: C.warn };
  return { label: 'ACTIVE', color: C.ok };
}

function formatBytes(bytes, decimals = 1) {
  if (!Number.isFinite(bytes)) return '不限量';
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / (1024 ** index);
  const digits = value >= 100 ? 0 : value >= 10 ? Math.min(1, decimals) : decimals;
  return `${value.toFixed(digits)} ${units[index]}`;
}

function formatDate(timestamp) { if (!timestamp) return '长期有效'; const date = new Date(timestamp); if (Number.isNaN(date.getTime())) return '--'; return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
function formatTime(timestamp) { if (!timestamp) return '--:--'; const date = new Date(timestamp); return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`; }
function optionalBytes(value) { return Number.isFinite(value) ? formatBytes(value) : '--'; }
function totalLabel(traffic) { return traffic.unlimited ? '不限量' : optionalBytes(traffic.total); }
function refreshDate(ctx) { return new Date(Date.now() + numberEnv(ctx, 'refreshHours', 2, 0.5, 24) * 3600000).toISOString(); }
function updateLabel(data) { return `${data.mode === 'stale' ? '缓存' : '更新'} ${formatTime(data.updatedAt)}`; }

function text(value, size, color, weight = 'regular', extra = {}) { return { type: 'text', text: String(value), font: { size, weight }, textColor: color, maxLines: 1, ...extra }; }
function icon(name, color, size = 14) { return { type: 'image', src: `sf-symbol:${name}`, width: size, height: size, color }; }

function header(data, compact = false) {
  const status = statusOf(data);
  return { type: 'stack', direction: 'row', alignItems: 'center', gap: compact ? 6 : 7, children: [
    icon('chart.pie.fill', C.accent, compact ? 14 : 15),
    text(data.name || 'SUBSCRIPTION', compact ? 10 : 11, C.dim, 'bold', { minScale: 0.62 }),
    { type: 'spacer' },
    { type: 'stack', direction: 'row', alignItems: 'center', gap: compact ? 0 : 5, padding: compact ? [3, 5] : [3, 7], backgroundColor: C.panel, borderRadius: 4, children: [
      { type: 'stack', width: 6, height: 6, borderRadius: 3, backgroundColor: status.color, children: [] },
      ...(compact ? [] : [text(status.label, 9, C.text, 'semibold')])
    ] }
  ] };
}

function progressBar(traffic, width) {
  const percent = percentRemaining(traffic);
  const fillWidth = percent == null ? width : Math.max(5, Math.round(width * percent / 100));
  return { type: 'stack', direction: 'row', width, height: 5, backgroundColor: C.track, borderRadius: 3, children: [{ type: 'stack', width: fillWidth, height: 5, backgroundColor: C.accent, borderRadius: 3, children: [] }] };
}
function progressOrNote(traffic, width) { return percentRemaining(traffic) == null && !traffic.unlimited ? text('服务商仅提供剩余流量', 9, C.dim, 'medium') : progressBar(traffic, width); }
function metric(label, value) { return { type: 'stack', direction: 'column', gap: 2, flex: 1, children: [text(label, 9, C.dim, 'semibold'), text(value, 12, C.text, 'semibold', { minScale: 0.68 })] }; }
function leadingLine(child, width) { return { type: 'stack', direction: 'row', width, children: [child, { type: 'spacer' }] }; }
function inlineMetric(label, value, minScale = 0.72) { return { type: 'stack', direction: 'row', alignItems: 'center', gap: 4, children: [text(label, 10, C.dim, 'medium'), text(value, 10, C.text, 'semibold', { minScale })] }; }
function daysMetric(value) { return { type: 'stack', direction: 'column', alignItems: 'center', gap: 1, width: 72, padding: [0, 0, 3, 0], children: [text('剩余天数', 8, C.dim, 'medium'), text(value, 12, C.text, 'semibold', { minScale: 0.72 })] }; }

function bytesToBase64(bytes) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; let output = '';
  for (let i = 0; i < bytes.length; i += 3) { const a = bytes[i], b = i + 1 < bytes.length ? bytes[i + 1] : 0, c = i + 2 < bytes.length ? bytes[i + 2] : 0, triple = (a << 16) | (b << 8) | c; output += alphabet[(triple >> 18) & 63] + alphabet[(triple >> 12) & 63]; output += i + 1 < bytes.length ? alphabet[(triple >> 6) & 63] : '='; output += i + 2 < bytes.length ? alphabet[triple & 63] : '='; }
  return output;
}

async function loadGaugeImage(ctx, traffic) {
  const used = usedPercentValue(traffic); if (used == null) return '';
  const display = formatPercentValue(used), rounded = Number(used.toFixed(2));
  const cacheKey = `egern.widget.pro.gauge.classic.v3.${rounded}`;
  const cached = ctx.storage?.get(cacheKey); if (cached) return cached;
  const fontSize = display.length >= 7 ? 28 : display.length >= 6 ? 31 : 36;
  const chart = { type: 'doughnut', data: { datasets: [{ data: [Math.max(0.0001, used), Math.max(0.0001, 100 - used)], backgroundColor: ['#7446D8', '#D0D0D8'], borderColor: ['rgba(0,0,0,0)', 'rgba(0,0,0,0)'], borderWidth: 1 }] }, options: { responsive: false, animation: false, rotation: 2.35619449, circumference: 4.71238898, cutoutPercentage: 82, legend: { display: false }, tooltips: { enabled: false }, plugins: { datalabels: { display: false }, doughnutlabel: { labels: [
    { text: ' ', font: { size: 12 }, color: 'rgba(0,0,0,0)' },
    { text: display, font: { size: fontSize, weight: 'bold', family: 'Helvetica Neue' }, color: '#7446D8' },
    { text: ' ', font: { size: 5 }, color: 'rgba(0,0,0,0)' },
    { text: '已用', font: { size: 20, weight: 'bold', family: 'Helvetica Neue' }, color: '#7B7B84' }
  ] } } } };
  const response = await ctx.http.post(GAUGE_API, { timeout: 8000, headers: { 'Content-Type': 'application/json' }, body: { version: '2', width: 280, height: 200, devicePixelRatio: 2, format: 'png', backgroundColor: 'transparent', chart } });
  if (response.status < 200 || response.status >= 300) throw new Error(`Gauge HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer()); if (!bytes.length) throw new Error('Gauge image is empty');
  const dataUri = `data:image/png;base64,${bytesToBase64(bytes)}`; ctx.storage?.set(cacheKey, dataUri); return dataUri;
}

function fallbackGauge(traffic, size = 108) { const used = usedPercentValue(traffic); return { type: 'stack', direction: 'column', alignItems: 'center', width: size, height: size, gap: 5, children: [{ type: 'spacer' }, icon('gauge.with.dots.needle.33percent', C.accent, 52), text(used == null ? '--' : formatPercentValue(used), 15, C.text, 'bold', { minScale: 0.68 }), text('已用', 12, C.dim, 'semibold'), { type: 'spacer' }] }; }
function gaugeView(data, traffic, size = 108) { return data.gaugeImage ? { type: 'image', src: data.gaugeImage, width: size + 18, height: size, resizeMode: 'contain' } : fallbackGauge(traffic, size); }

function emptyWidget(data, family, ctx) {
  const isSmall = family === 'systemSmall', setup = data.mode === 'setup';
  return { type: 'widget', backgroundColor: C.bg, padding: isSmall ? 14 : 16, gap: 8, refreshAfter: refreshDate(ctx), children: [header(data, isSmall), { type: 'spacer' }, { type: 'stack', direction: 'column', alignItems: 'center', gap: 6, children: [icon(setup ? 'link.badge.plus' : 'exclamationmark.triangle', setup ? C.dim : C.fail, 22), text(setup ? '等待订阅地址' : '无法读取流量', isSmall ? 13 : 15, C.text, 'semibold'), text(setup ? '请配置 url1' : data.error, 9, C.dim, 'medium', { minScale: 0.65 })] }, { type: 'spacer' }] };
}

function mediumWidget(data, ctx) {
  if (!data.traffic) return emptyWidget(data, 'systemMedium', ctx);
  const traffic = data.traffic, days = daysRemaining(traffic.expireAt), daysText = days == null ? '长期' : `${Math.max(0, days)} 天`;
  return { type: 'widget', backgroundColor: C.bg, padding: [13, 16, 13, 16], gap: 8, refreshAfter: refreshDate(ctx), children: [
    header(data),
    { type: 'stack', direction: 'row', alignItems: 'start', gap: 12, children: [
      { type: 'stack', direction: 'column', gap: 5, width: 200, height: 112, children: [
        leadingLine(text(formatBytes(traffic.remaining), 29, C.text, 'bold', { font: { size: 29, weight: 'bold', family: 'Menlo' }, minScale: 0.62 }), 200),
        leadingLine(text('剩余流量', 11, C.dim, 'semibold'), 200),
        { type: 'stack', direction: 'row', alignItems: 'end', width: 200, children: [inlineMetric('已用', optionalBytes(traffic.used)), { type: 'spacer' }, daysMetric(daysText)] },
        leadingLine(inlineMetric('到期', formatDate(traffic.expireAt), 0.68), 200),
        { type: 'spacer' },
        leadingLine(text(updateLabel(data), 9, C.dim, 'medium', { minScale: 0.7 }), 200)
      ] },
      { type: 'stack', direction: 'column', alignItems: 'center', gap: 2, width: 118, height: 112, children: [
        gaugeView(data, traffic, 100),
        { type: 'stack', direction: 'row', alignItems: 'center', gap: 4, children: [text('套餐', 9, C.dim, 'semibold'), text(totalLabel(traffic), 9, C.text, 'semibold', { minScale: 0.68 })] }
      ] }
    ] }
  ] };
}

function smallWidget(data, ctx) {
  if (!data.traffic) return emptyWidget(data, 'systemSmall', ctx); const traffic = data.traffic;
  return { type: 'widget', backgroundColor: C.bg, padding: 14, gap: 7, refreshAfter: refreshDate(ctx), children: [header(data, true), { type: 'spacer' }, text(formatBytes(traffic.remaining), 25, C.text, 'bold', { font: { size: 25, weight: 'bold', family: 'Menlo' }, minScale: 0.58 }), { type: 'stack', direction: 'row', children: [text('剩余流量', 10, C.dim, 'medium'), { type: 'spacer' }, text(formatPercentValue(percentRemaining(traffic)), 10, C.text, 'semibold')] }, progressOrNote(traffic, 126), { type: 'spacer' }, text(`到期 ${formatDate(traffic.expireAt)}`, 9, C.dim, 'medium')] };
}

function largeWidget(data, ctx) {
  if (!data.traffic) return emptyWidget(data, 'systemLarge', ctx); const traffic = data.traffic, days = daysRemaining(traffic.expireAt), daily = days && days > 0 && Number.isFinite(traffic.remaining) ? traffic.remaining / days : null;
  return { type: 'widget', backgroundColor: C.bg, padding: 16, gap: 10, refreshAfter: refreshDate(ctx), children: [header(data), { type: 'stack', direction: 'row', alignItems: 'center', gap: 12, padding: [11, 14], backgroundColor: C.panel, borderRadius: 8, children: [icon('arrow.up.arrow.down.circle.fill', C.accent, 28), { type: 'stack', direction: 'column', gap: 2, flex: 1, children: [text(formatBytes(traffic.remaining), 22, C.text, 'bold', { font: { size: 22, weight: 'bold', family: 'Menlo' }, minScale: 0.6 }), text('剩余流量', 10, C.dim, 'medium')] }, text(formatPercentValue(percentRemaining(traffic)), 18, C.text, 'bold')] }, progressOrNote(traffic, 300), { type: 'stack', direction: 'row', gap: 12, children: [metric('下载', optionalBytes(traffic.download)), metric('上传', optionalBytes(traffic.upload)), metric('合计已用', optionalBytes(traffic.used))] }, { type: 'stack', height: 1, backgroundColor: C.hairline, children: [] }, { type: 'stack', direction: 'row', gap: 12, children: [metric('套餐总量', totalLabel(traffic)), metric('剩余天数', days == null ? '长期' : `${Math.max(0, days)} 天`), metric('日均可用', daily == null ? '--' : formatBytes(daily))] }, { type: 'spacer' }, { type: 'stack', direction: 'row', children: [text(updateLabel(data), 9, C.dim, 'medium'), { type: 'spacer' }, text(`到期 ${formatDate(traffic.expireAt)}`, 9, C.dim, 'semibold')] }] };
}

function lockWidget(data, family) {
  if (!data.traffic) return { type: 'widget', children: [text(data.mode === 'setup' ? '订阅流量：待配置' : '订阅流量：读取失败', 12, C.text, 'semibold')] };
  const traffic = data.traffic, remaining = formatBytes(traffic.remaining);
  if (family === 'accessoryInline') return { type: 'widget', children: [text(`剩余 ${remaining} · ${formatPercentValue(percentRemaining(traffic))}`, 12, C.text, 'semibold')] };
  if (family === 'accessoryCircular') return { type: 'widget', padding: 4, children: [icon('chart.pie.fill', C.text, 15), text(formatPercentValue(percentRemaining(traffic)), 12, C.text, 'bold', { textAlign: 'center' })] };
  return { type: 'widget', gap: 2, children: [{ type: 'stack', direction: 'row', alignItems: 'center', gap: 5, children: [icon('chart.pie.fill', C.text, 12), text(data.name, 11, C.text, 'semibold')] }, text(`剩余 ${remaining} · 到期 ${formatDate(traffic.expireAt)}`, 12, C.text, 'bold')] };
}

export default async function(ctx) {
  const data = await loadData(ctx), family = ctx.widgetFamily || 'systemMedium';
  if (family === 'systemMedium' && data.traffic) { try { data.gaugeImage = await loadGaugeImage(ctx, data.traffic); } catch { data.gaugeImage = ''; } }
  if (family.startsWith('accessory')) return lockWidget(data, family);
  if (family === 'systemSmall') return smallWidget(data, ctx);
  if (family === 'systemLarge' || family === 'systemExtraLarge') return largeWidget(data, ctx);
  return mediumWidget(data, ctx);
}
