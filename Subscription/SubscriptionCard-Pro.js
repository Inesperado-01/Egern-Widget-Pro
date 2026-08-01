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
  track: { light: '#E8E8ED', dark: '#202025' },
  accent: { light: '#7446D8', dark: '#B765FF' },
  ok: { light: '#2F9E58', dark: '#9DFF32' },
  warn: { light: '#A06400', dark: '#FFBE3F' },
  fail: { light: '#D64545', dark: '#FF626A' }
};

const SHARED_CACHE_MS = 5 * 60 * 1000;

function env(ctx) {
  const map = {};
  for (const [key, value] of Object.entries(ctx.env || {})) {
    map[String(key).toLowerCase()] = value;
  }
  return (key, fallback = '') => {
    const value = map[String(key).toLowerCase()];
    return value == null || value === '' ? fallback : value;
  };
}

function numberEnv(ctx, key, fallback, min, max) {
  const value = Number(env(ctx)(key, fallback));
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function hashString(value) {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(i);
  }
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

  return {
    upload,
    download,
    total,
    used,
    remaining: unlimited ? Infinity : Math.max(0, total - used),
    unlimited,
    expireAt: expire > 1e12 ? expire : expire * 1000
  };
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
  const used = Number.isFinite(explicitUsed)
    ? explicitUsed
    : Number.isFinite(total)
      ? Math.max(0, total - remaining)
      : null;

  let expireAt = 0;
  if (expireMatch) {
    const parsed = new Date(`${expireMatch[1].replace(/[/.]/g, '-')}T23:59:59`);
    if (!Number.isNaN(parsed.getTime())) expireAt = parsed.getTime();
  }

  return {
    upload: null,
    download: null,
    total,
    used,
    remaining,
    unlimited: false,
    expireAt,
    partial: !Number.isFinite(total)
  };
}

function applyPlanTotal(ctx, traffic) {
  const totalGB = Number(env(ctx)('totalGB', 100));
  if (!traffic || Number.isFinite(traffic.total) || !Number.isFinite(totalGB) || totalGB <= 0) return traffic;
  const total = totalGB * (1024 ** 3);
  return {
    ...traffic,
    total,
    used: Math.max(0, total - traffic.remaining),
    partial: false,
    totalEstimated: true
  };
}

async function fetchSubscription(ctx, url) {
  const customUA = String(env(ctx)('ua', '')).trim();
  const userAgents = [...new Set([
    customUA,
    'clash.meta',
    'clash-verge/v2.2.3',
    'Surge/5.0',
    'Quantumult%20X/1.5.0'
  ].filter(Boolean))];

  const extract = async response => {
    const headerData = parseUserInfo(readHeader(response?.headers, 'subscription-userinfo'));
    if (headerData) return headerData;
    try {
      return parseBodyInfo(await response.text());
    } catch {
      return null;
    }
  };

  for (const userAgent of userAgents) {
    try {
      const response = await ctx.http.get(url, {
        timeout: 8000,
        redirect: 'manual',
        headers: { 'User-Agent': userAgent }
      });
      const direct = await extract(response);
      if (direct) return direct;

      const location = readHeader(response.headers, 'location');
      if (location && response.status >= 300 && response.status < 400) {
        const redirected = await ctx.http.get(new URL(location, url).toString(), {
          timeout: 8000,
          redirect: 'follow',
          headers: { 'User-Agent': userAgent }
        });
        const final = await extract(redirected);
        if (final) return final;
      }
    } catch {
      // Continue with another common client identity.
    }
  }

  throw new Error('订阅未返回可识别的流量信息');
}

async function loadData(ctx) {
  const get = env(ctx);
  const url = String(get('url1', '')).trim();
  const name = String(get('name1', 'SUBSCRIPTION')).trim();
  if (!url) return { mode: 'setup', name };

  const key = `egern.widget.pro.subscription.v7.${hashString(url)}`;
  const cached = ctx.storage?.getJSON(key);

  if (cached?.traffic && Date.now() - Number(cached.updatedAt || 0) < SHARED_CACHE_MS) {
    return { ...cached, mode: 'live', name, shared: true };
  }

  try {
    const traffic = applyPlanTotal(ctx, await fetchSubscription(ctx, url));
    const result = { mode: 'live', name, traffic, updatedAt: Date.now() };
    ctx.storage?.setJSON(key, result);
    return result;
  } catch (error) {
    if (cached?.traffic) {
      return {
        ...cached,
        traffic: applyPlanTotal(ctx, cached.traffic),
        mode: 'stale',
        name,
        error: String(error?.message || error)
      };
    }
    return { mode: 'error', name, error: String(error?.message || error || '加载失败') };
  }
}

function daysRemaining(expireAt) {
  return expireAt ? Math.ceil((expireAt - Date.now()) / 86400000) : null;
}

function percentRemaining(traffic) {
  if (traffic.unlimited || !Number.isFinite(traffic.total) || traffic.total <= 0) return null;
  return Math.max(0, Math.min(100, (traffic.remaining / traffic.total) * 100));
}

function formatPercent(traffic) {
  const value = percentRemaining(traffic);
  if (value == null) return traffic.unlimited ? '∞' : '--';
  if (value === 0 || value === 100) return `${value.toFixed(0)}%`;
  return `${value.toFixed(2).replace(/0$/, '')}%`;
}

function statusOf(data) {
  if (data.mode === 'setup') return { label: 'SETUP', color: C.dim };
  if (data.mode === 'error') return { label: 'ERROR', color: C.fail };
  if (data.mode === 'stale') return { label: 'STALE', color: C.warn };

  const days = daysRemaining(data.traffic.expireAt);
  const ratio = percentRemaining(data.traffic);
  if ((!data.traffic.unlimited && data.traffic.remaining <= 0) || (days != null && days <= 0)) {
    return { label: 'EXPIRED', color: C.fail };
  }
  if ((ratio != null && ratio <= 20) || (days != null && days <= 7)) {
    return { label: 'LOW', color: C.warn };
  }
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

function formatDate(timestamp) {
  if (!timestamp) return '长期有效';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '--';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatTime(timestamp) {
  if (!timestamp) return '--:--';
  const date = new Date(timestamp);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function optionalBytes(value) {
  return Number.isFinite(value) ? formatBytes(value) : '--';
}

function totalLabel(traffic) {
  return traffic.unlimited ? '不限量' : optionalBytes(traffic.total);
}

function refreshDate(ctx) {
  return new Date(Date.now() + numberEnv(ctx, 'refreshHours', 2, 0.5, 24) * 3600000).toISOString();
}

function updateLabel(data) {
  return `${data.mode === 'stale' ? '缓存' : '更新'} ${formatTime(data.updatedAt)}`;
}

function text(value, size, color, weight = 'regular', extra = {}) {
  return {
    type: 'text',
    text: String(value),
    font: { size, weight },
    textColor: color,
    maxLines: 1,
    ...extra
  };
}

function icon(name, color, size = 14) {
  return { type: 'image', src: `sf-symbol:${name}`, width: size, height: size, color };
}

function header(data, compact = false) {
  const status = statusOf(data);
  return {
    type: 'stack', direction: 'row', alignItems: 'center', gap: compact ? 6 : 8,
    children: [
      icon('chart.pie.fill', C.accent, compact ? 14 : 15),
      text(data.name || 'SUBSCRIPTION', compact ? 10 : 11, C.dim, 'bold', { minScale: 0.64 }),
      { type: 'spacer' },
      {
        type: 'stack', direction: 'row', alignItems: 'center', gap: compact ? 0 : 3,
        padding: compact ? [3, 5] : [2, 5], backgroundColor: C.panel, borderRadius: 4,
        children: [
          { type: 'stack', width: 6, height: 6, borderRadius: 3, backgroundColor: status.color, children: [] },
          ...(compact ? [] : [text(status.label, 9, C.text, 'semibold')])
        ]
      }
    ]
  };
}

function progressBar(traffic, width) {
  const percent = percentRemaining(traffic);
  const fillWidth = percent == null ? width : Math.max(5, Math.round(width * percent / 100));
  return {
    type: 'stack', direction: 'row', width, height: 5,
    backgroundColor: C.track, borderRadius: 3,
    children: [
      { type: 'stack', width: fillWidth, height: 5, backgroundColor: C.accent, borderRadius: 3, children: [] }
    ]
  };
}

function progressOrNote(traffic, width) {
  return percentRemaining(traffic) == null && !traffic.unlimited
    ? text('服务商仅提供剩余流量', 9, C.dim, 'medium')
    : progressBar(traffic, width);
}

function metric(label, value) {
  return {
    type: 'stack', direction: 'column', gap: 3, flex: 1,
    children: [
      text(label, 9, C.dim, 'semibold'),
      text(value, 12, C.text, 'semibold', { minScale: 0.68 })
    ]
  };
}

function mediumMetric(label, value) {
  return {
    type: 'stack', direction: 'column', alignItems: 'center', gap: 3, flex: 1,
    children: [
      text(label, 10, C.dim, 'semibold'),
      text(value, 13, C.text, 'bold', { minScale: 0.72 })
    ]
  };
}

function emptyWidget(data, family, ctx) {
  const isSmall = family === 'systemSmall';
  const setup = data.mode === 'setup';
  return {
    type: 'widget', backgroundColor: C.bg, padding: isSmall ? 14 : 16, gap: 8,
    refreshAfter: refreshDate(ctx),
    children: [
      header(data, isSmall),
      { type: 'spacer' },
      {
        type: 'stack', direction: 'column', alignItems: 'center', gap: 6,
        children: [
          icon(setup ? 'link.badge.plus' : 'exclamationmark.triangle', setup ? C.dim : C.fail, 22),
          text(setup ? '等待订阅地址' : '无法读取流量', isSmall ? 13 : 15, C.text, 'semibold'),
          text(setup ? '请配置 url1' : data.error, 9, C.dim, 'medium', { minScale: 0.65 })
        ]
      },
      { type: 'spacer' }
    ]
  };
}

function smallWidget(data, ctx) {
  if (!data.traffic) return emptyWidget(data, 'systemSmall', ctx);
  const traffic = data.traffic;
  return {
    type: 'widget', backgroundColor: C.bg, padding: 14, gap: 7,
    refreshAfter: refreshDate(ctx),
    children: [
      header(data, true),
      { type: 'spacer' },
      text(formatBytes(traffic.remaining), 25, C.text, 'bold', {
        font: { size: 25, weight: 'bold', family: 'Menlo' }, minScale: 0.58
      }),
      {
        type: 'stack', direction: 'row', children: [
          text('剩余流量', 10, C.dim, 'medium'),
          { type: 'spacer' },
          text(formatPercent(traffic), 10, C.text, 'semibold')
        ]
      },
      { type: 'stack', height: 2, children: [] },
      progressOrNote(traffic, 126),
      { type: 'spacer' },
      text(`到期 ${formatDate(traffic.expireAt)}`, 9, C.dim, 'medium', { minScale: 0.7 })
    ]
  };
}

function mediumWidget(data, ctx) {
  if (!data.traffic) return emptyWidget(data, 'systemMedium', ctx);
  const traffic = data.traffic;
  const days = daysRemaining(traffic.expireAt);
  const daysText = days == null ? '长期' : `${Math.max(0, days)} 天`;

  return {
    type: 'widget', backgroundColor: C.bg, padding: [13, 16], gap: 7,
    refreshAfter: refreshDate(ctx),
    children: [
      header(data),
      {
        type: 'stack', direction: 'row', alignItems: 'end', gap: 12,
        children: [
          {
            type: 'stack', direction: 'column', alignItems: 'start', gap: 2, flex: 1,
            children: [
              text(formatBytes(traffic.remaining), 29, C.text, 'bold', {
                font: { size: 29, weight: 'bold', family: 'Menlo' }, minScale: 0.62
              }),
              text('剩余流量', 10, C.dim, 'semibold')
            ]
          },
          {
            type: 'stack', direction: 'column', alignItems: 'end', gap: 2,
            children: [
              text(formatPercent(traffic), 16, C.text, 'bold', { minScale: 0.72 }),
              text('剩余比例', 9, C.dim, 'semibold')
            ]
          }
        ]
      },
      progressOrNote(traffic, 320),
      { type: 'stack', height: 2, children: [] },
      {
        type: 'stack', direction: 'row', gap: 12,
        children: [
          mediumMetric('已用', optionalBytes(traffic.used)),
          mediumMetric('套餐总量', totalLabel(traffic)),
          mediumMetric('剩余天数', daysText)
        ]
      },
      { type: 'stack', height: 3, children: [] },
      {
        type: 'stack', direction: 'row', children: [
          text(updateLabel(data), 9, C.dim, 'medium'),
          { type: 'spacer' },
          text(`到期 ${formatDate(traffic.expireAt)}`, 9, C.dim, 'semibold')
        ]
      }
    ]
  };
}

function largeWidget(data, ctx) {
  if (!data.traffic) return emptyWidget(data, 'systemLarge', ctx);
  const traffic = data.traffic;
  const days = daysRemaining(traffic.expireAt);
  const daily = days && days > 0 && Number.isFinite(traffic.remaining)
    ? traffic.remaining / days
    : null;

  return {
    type: 'widget', backgroundColor: C.bg, padding: 16, gap: 7,
    refreshAfter: refreshDate(ctx),
    children: [
      header(data),
      {
        type: 'stack', direction: 'row', alignItems: 'center', gap: 10,
        padding: [10, 12], backgroundColor: C.panel, borderRadius: 8,
        children: [
          icon('arrow.up.arrow.down.circle.fill', C.accent, 24),
          {
            type: 'stack', direction: 'column', gap: 2, flex: 1,
            children: [
              text(formatBytes(traffic.remaining), 22, C.text, 'bold', {
                font: { size: 22, weight: 'bold', family: 'Menlo' }, minScale: 0.6
              }),
              text('剩余流量', 10, C.dim, 'medium')
            ]
          },
          text(formatPercent(traffic), 15, C.text, 'bold')
        ]
      },
      progressOrNote(traffic, 300),
      { type: 'stack', height: 4, children: [] },
      {
        type: 'stack', direction: 'row', gap: 12,
        children: [
          metric('下载', optionalBytes(traffic.download)),
          metric('上传', optionalBytes(traffic.upload)),
          metric('合计已用', optionalBytes(traffic.used))
        ]
      },
      { type: 'stack', height: 7, children: [] },
      {
        type: 'stack', direction: 'row', gap: 12,
        children: [
          metric('套餐总量', totalLabel(traffic)),
          metric('剩余天数', days == null ? '长期' : `${Math.max(0, days)} 天`),
          metric('日均可用', daily == null ? '--' : formatBytes(daily))
        ]
      },
      { type: 'spacer' },
      {
        type: 'stack', direction: 'row', children: [
          text(updateLabel(data), 9, C.dim, 'medium'),
          { type: 'spacer' },
          text(`到期 ${formatDate(traffic.expireAt)}`, 9, C.dim, 'semibold')
        ]
      }
    ]
  };
}

function lockWidget(data, family) {
  if (!data.traffic) {
    return {
      type: 'widget',
      children: [text(data.mode === 'setup' ? '订阅流量：待配置' : '订阅流量：读取失败', 12, C.text, 'semibold')]
    };
  }

  const traffic = data.traffic;
  const remaining = formatBytes(traffic.remaining);

  if (family === 'accessoryInline') {
    return {
      type: 'widget',
      children: [text(`剩余 ${remaining} · ${formatPercent(traffic)}`, 12, C.text, 'semibold')]
    };
  }

  if (family === 'accessoryCircular') {
    return {
      type: 'widget', padding: 4,
      children: [
        icon('chart.pie.fill', C.text, 15),
        text(formatPercent(traffic), 12, C.text, 'bold', { textAlign: 'center' })
      ]
    };
  }

  return {
    type: 'widget', gap: 2,
    children: [
      {
        type: 'stack', direction: 'row', alignItems: 'center', gap: 5,
        children: [icon('chart.pie.fill', C.text, 12), text(data.name, 11, C.text, 'semibold')]
      },
      text(`剩余 ${remaining} · 到期 ${formatDate(traffic.expireAt)}`, 12, C.text, 'bold')
    ]
  };
}

export default async function(ctx) {
  const data = await loadData(ctx);
  const family = ctx.widgetFamily || 'systemMedium';

  if (family.startsWith('accessory')) return lockWidget(data, family);
  if (family === 'systemSmall') return smallWidget(data, ctx);
  if (family === 'systemLarge' || family === 'systemExtraLarge') return largeWidget(data, ctx);
  return mediumWidget(data, ctx);
}
