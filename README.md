# Egern Widget Pro

Customized Egern widgets with adaptive light and dark themes.

## Subscription Card Pro

当前首个组件：订阅流量监控卡片。

### 远程脚本地址

```text
https://raw.githubusercontent.com/Inesperado-01/Egern-Widget-Pro/main/Subscription/SubscriptionCard-Pro.js
```

### Egern 配置

在 Egern 中创建一个 **通用脚本 / Generic Script**，脚本地址填写上面的 Raw 链接。

必填环境变量：

```text
SUBSCRIPTION_URL=你的完整订阅链接
```

可选环境变量：

```text
SUBSCRIPTION_NAME=机场名称
REFRESH_HOURS=2
SUBSCRIPTION_USER_AGENT=clash.meta
PLAN_TOTAL_GB=100
```

| 变量 | 作用 | 默认值 |
|---|---|---|
| `SUBSCRIPTION_URL` | 完整订阅链接 | 必填 |
| `SUBSCRIPTION_NAME` | 小组件显示名称 | `SUBSCRIPTION` |
| `REFRESH_HOURS` | 建议刷新间隔，单位小时 | `2` |
| `SUBSCRIPTION_USER_AGENT` | 请求订阅时使用的 UA | 自动尝试常见 UA |
| `PLAN_TOTAL_GB` | 订阅未返回总量时的兜底套餐容量 | `100` |

### V1 改动

- 保留自动浅色 / 深色外观。
- 小号顶部改为机场名称，并仅保留状态圆点，避免文字截断。
- 中号半圆仪表盘统一显示“剩余百分比”。
- 中号和大号增加最后更新时间。
- 大号百分比明确标注为“剩余”。
- 保留订阅响应头、正文兜底、缓存和多 User-Agent 重试逻辑。

## 更新方式

以后脚本更新仍使用同一个 Raw 地址。GitHub 更新后，在 Egern 内刷新远程脚本或小组件即可获取新版。

## 来源说明

Subscription Card Pro 基于 Aswoth/Keek 的公开 `Dingyue` 脚本进行改版，并在此仓库中独立维护。
