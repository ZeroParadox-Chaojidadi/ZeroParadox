/**
 * 本项目内置的 Microsoft Azure 应用（appID）。
 *
 * 该应用已于 2026-10-21 通过 Mojang 的 appID 审批（AppID Review Complete），
 * 被加入 Minecraft 服务的允许名单，因此启动器可以开箱即用微软正版登录，
 * 用户不需要自己注册 Azure 应用。
 *
 * 注意：审批按 appID 生效。如果用户改成自己的 Client ID，那个 ID 仍需
 * 单独通过 https://aka.ms/AppRegInfo 提交审批。
 */
export const BUILT_IN_MICROSOFT_CLIENT_ID = '712cdc62-f369-4fe5-8285-6b683c84d877'
