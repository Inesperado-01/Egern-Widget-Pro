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
url1=你的完整订阅链接
```

可选环境变量：

```text
name1=机场名称
refreshHours=2
ua=clash.meta
totalGB=100
```

环境变量名称不区分大小写，例如 `url1`、`URL1`、`Url1` 均可识别。

| 变量 | 作用 | 默认值 |
|---|---|---|
| `url1` | 完整订阅链接 | 必填 |
| `name1` | 小组件显示名称 | `SUBSCRIPTION` |
| `refreshHours` | 建议刷新间隔，单位小时 | `2` |
| `ua` | 请求订阅时使用的 User-Agent | 自动尝试常见 UA |
| `totalGB` | 订阅未返回总量时的兜底套餐容量 | `100` |

### 当前改动

- 使用简短、含义明确的环境变量。
- 环境变量名称不区分大小写。
- 不保留尚未正式投入使用的旧变量兼容逻辑。
- 保留自动浅色 / 深色外观。
- 小号顶部显示机场名称，并仅保留状态圆点。
- 中号半圆仪表盘显示剩余百分比。
- 中号和大号显示最后更新时间。
- 保留订阅响应头、正文兜底、缓存和多 User-Agent 重试逻辑。

## 更新方式

以后脚本更新仍使用同一个 Raw 地址。GitHub 更新后，在 Egern 内刷新远程脚本或小组件即可获取新版。

## 来源说明

Subscription Card Pro 基于 Aswoth/Keek 的公开 `Dingyue` 脚本进行改版，并在此仓库中独立维护。
