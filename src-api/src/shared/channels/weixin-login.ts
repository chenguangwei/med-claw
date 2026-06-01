import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import QRCode from 'qrcode';
import {
  logout as sdkLogout,
  start as sdkStart,
  type Agent,
  type ChatResponse,
  type StartOptions,
} from 'weixin-agent-sdk';

import { getAppDir } from '@/config/constants';

import type {
  ChannelConnectionStatus,
  ChannelConversationType,
  ChannelInboundMessage,
  ChannelInboundResult,
  WeixinLoginSession,
} from './types';

const WEIXIN_API_BASE_URL = 'https://ilinkai.weixin.qq.com';
const GET_QRCODE_TIMEOUT_MS = 5_000;
const QR_LONG_POLL_TIMEOUT_MS = 35_000;
const LOGIN_TIMEOUT_MS = 8 * 60_000;
const QR_REFRESH_LIMIT = 3;
const POLL_INTERVAL_MS = 1_000;

type WeixinProviderStatus =
  | 'wait'
  | 'scaned'
  | 'scaned_but_redirect'
  | 'confirmed'
  | 'expired';

interface WeixinQrResponse {
  qrcode: string;
  qrcode_img_content?: string;
}

interface WeixinStatusResponse {
  status: WeixinProviderStatus;
  bot_token?: string;
  ilink_bot_id?: string;
  ilink_user_id?: string;
  baseurl?: string;
  redirect_host?: string;
}

interface ActiveLogin extends WeixinLoginSession {
  rawQRCode: string;
  currentApiBaseUrl: string;
  startedAt: number;
  refreshCount: number;
}

interface WeixinBotInstance {
  wait(): Promise<void>;
}

type WeixinStartBot = (
  agent: Agent,
  options?: StartOptions
) => WeixinBotInstance;

type WeixinLogout = (options?: { log?: (message: string) => void }) => void;

export interface WeixinLoginManagerOptions {
  inboundHandler: (
    message: ChannelInboundMessage
  ) => Promise<ChannelInboundResult>;
  fetchQRCode?: () => Promise<WeixinQrResponse>;
  pollQRCodeStatus?: (
    qrcode: string,
    apiBaseUrl: string
  ) => Promise<WeixinStatusResponse>;
  startBot?: WeixinStartBot;
  logout?: WeixinLogout;
  stateDir?: string;
  autoStartStoredConnection?: boolean;
}

function nowIso(): string {
  return new Date().toISOString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}

function normalizeAccountId(raw: string): string {
  return raw.trim().toLowerCase().replace(/[@.]/g, '-');
}

async function fetchJson<T>(
  baseUrl: string,
  endpoint: string,
  timeoutMs: number
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const url = new URL(endpoint, ensureTrailingSlash(baseUrl));

  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      signal: controller.signal,
    });
    const raw = await response.text();
    if (!response.ok) {
      throw new Error(`微信连接服务响应异常：${response.status}`);
    }
    return JSON.parse(raw) as T;
  } finally {
    clearTimeout(timeout);
  }
}

async function defaultFetchQRCode(): Promise<WeixinQrResponse> {
  return fetchJson<WeixinQrResponse>(
    WEIXIN_API_BASE_URL,
    'ilink/bot/get_bot_qrcode?bot_type=3',
    GET_QRCODE_TIMEOUT_MS
  );
}

async function defaultPollQRCodeStatus(
  qrcode: string,
  apiBaseUrl: string
): Promise<WeixinStatusResponse> {
  try {
    return await fetchJson<WeixinStatusResponse>(
      apiBaseUrl,
      `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`,
      QR_LONG_POLL_TIMEOUT_MS
    );
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { status: 'wait' };
    }
    throw error;
  }
}

function resolveOpenClawStateDir(stateDir?: string): string {
  const resolved =
    stateDir ||
    process.env.OPENCLAW_STATE_DIR?.trim() ||
    process.env.CLAWDBOT_STATE_DIR?.trim() ||
    path.join(getAppDir(), 'openclaw');

  process.env.OPENCLAW_STATE_DIR = resolved;
  return resolved;
}

function resolveWeixinStateDir(stateDir: string): string {
  return path.join(stateDir, 'openclaw-weixin');
}

function resolveAccountIndexPath(stateDir: string): string {
  return path.join(resolveWeixinStateDir(stateDir), 'accounts.json');
}

function resolveAccountsDir(stateDir: string): string {
  return path.join(resolveWeixinStateDir(stateDir), 'accounts');
}

function resolveAccountPath(stateDir: string, accountId: string): string {
  return path.join(resolveAccountsDir(stateDir), `${accountId}.json`);
}

function readAccountIds(stateDir: string): string[] {
  try {
    const raw = fs.readFileSync(resolveAccountIndexPath(stateDir), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === 'string' && !!id);
  } catch {
    return [];
  }
}

function saveWeixinAccount(
  stateDir: string,
  accountId: string,
  update: { token?: string; baseUrl?: string; userId?: string }
): void {
  const accountsDir = resolveAccountsDir(stateDir);
  fs.mkdirSync(accountsDir, { recursive: true });

  const data = {
    ...(update.token?.trim()
      ? { token: update.token.trim(), savedAt: nowIso() }
      : {}),
    ...(update.baseUrl?.trim() ? { baseUrl: update.baseUrl.trim() } : {}),
    ...(update.userId?.trim() ? { userId: update.userId.trim() } : {}),
  };

  const accountPath = resolveAccountPath(stateDir, accountId);
  fs.writeFileSync(accountPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  try {
    fs.chmodSync(accountPath, 0o600);
  } catch {
    // Best effort; Windows and packaged runtimes may not support chmod.
  }
}

function registerWeixinAccount(stateDir: string, accountId: string): void {
  const dir = resolveWeixinStateDir(stateDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    resolveAccountIndexPath(stateDir),
    `${JSON.stringify([accountId], null, 2)}\n`,
    'utf8'
  );
}

function mediaToChatResponse(
  media: ChannelInboundResult['reply']['media']
): ChatResponse['media'] | undefined {
  const attachment = media?.[0];
  const url = attachment?.url || attachment?.filePath;
  if (!attachment || !url) return undefined;
  if (attachment.type === 'audio') return undefined;

  return {
    type: attachment.type,
    url,
    fileName: attachment.fileName,
  };
}

export class WeixinLoginManager {
  private readonly inboundHandler: WeixinLoginManagerOptions['inboundHandler'];
  private readonly fetchQRCode: () => Promise<WeixinQrResponse>;
  private readonly pollQRCodeStatus: (
    qrcode: string,
    apiBaseUrl: string
  ) => Promise<WeixinStatusResponse>;
  private readonly startBot: WeixinStartBot;
  private readonly logout: WeixinLogout;
  private readonly stateDir: string;
  private readonly sessions = new Map<string, ActiveLogin>();
  private botAbortController?: AbortController;
  private bot?: WeixinBotInstance;
  private connection: ChannelConnectionStatus = {
    channel: 'weixin',
    connected: false,
    status: 'disconnected',
    message: '微信尚未连接。',
    updatedAt: nowIso(),
  };

  constructor(options: WeixinLoginManagerOptions) {
    this.inboundHandler = options.inboundHandler;
    this.fetchQRCode = options.fetchQRCode || defaultFetchQRCode;
    this.pollQRCodeStatus = options.pollQRCodeStatus || defaultPollQRCodeStatus;
    this.startBot = options.startBot || sdkStart;
    this.logout = options.logout || sdkLogout;
    this.stateDir = resolveOpenClawStateDir(options.stateDir);

    if (options.autoStartStoredConnection !== false) {
      setTimeout(() => {
        this.resumeStoredConnection().catch((error) => {
          this.connection = {
            channel: 'weixin',
            connected: false,
            status: 'failed',
            message:
              error instanceof Error ? error.message : '微信自动连接失败。',
            updatedAt: nowIso(),
          };
        });
      }, 0);
    }
  }

  async startLogin(
    options: { force?: boolean } = {}
  ): Promise<WeixinLoginSession> {
    const active = [...this.sessions.values()].find((session) =>
      ['waiting', 'scanned'].includes(session.status)
    );
    if (active && !options.force) return this.toPublicSession(active);
    if (active) this.cancelLogin(active.sessionId);

    const qr = await this.fetchQRCode();
    const qrCodeUrl = qr.qrcode_img_content || qr.qrcode;
    if (!qr.qrcode || !qrCodeUrl) {
      throw new Error('微信二维码生成失败，请稍后重试。');
    }

    const now = Date.now();
    const session: ActiveLogin = {
      sessionId: crypto.randomUUID(),
      status: 'waiting',
      rawQRCode: qr.qrcode,
      qrCodeUrl,
      qrCodeSvg: await QRCode.toString(qrCodeUrl, {
        type: 'svg',
        margin: 1,
        width: 240,
      }),
      currentApiBaseUrl: WEIXIN_API_BASE_URL,
      startedAt: now,
      refreshCount: 1,
      expiresAt: new Date(now + LOGIN_TIMEOUT_MS).toISOString(),
      message: '请使用手机微信扫描二维码。',
      updatedAt: nowIso(),
    };

    this.sessions.set(session.sessionId, session);
    this.connection = {
      channel: 'weixin',
      connected: false,
      status: 'waiting',
      message: '等待微信扫码。',
      updatedAt: nowIso(),
    };

    void this.pollLogin(session.sessionId);
    return this.toPublicSession(session);
  }

  getLoginSession(sessionId: string): WeixinLoginSession | null {
    const session = this.sessions.get(sessionId);
    return session ? this.toPublicSession(session) : null;
  }

  cancelLogin(sessionId: string): WeixinLoginSession | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    session.status = 'cancelled';
    session.message = '已取消微信连接。';
    session.updatedAt = nowIso();
    this.sessions.delete(sessionId);
    if (!this.connection.connected) {
      this.connection = {
        channel: 'weixin',
        connected: false,
        status: 'disconnected',
        message: '微信尚未连接。',
        updatedAt: nowIso(),
      };
    }
    return this.toPublicSession(session);
  }

  getConnectionStatus(): ChannelConnectionStatus {
    return { ...this.connection };
  }

  async disconnect(): Promise<ChannelConnectionStatus> {
    this.botAbortController?.abort();
    this.botAbortController = undefined;
    this.bot = undefined;
    this.logout({ log: () => undefined });
    this.connection = {
      channel: 'weixin',
      connected: false,
      status: 'disconnected',
      message: '微信连接已断开。',
      updatedAt: nowIso(),
    };
    return this.getConnectionStatus();
  }

  private async resumeStoredConnection(): Promise<void> {
    const accountId = readAccountIds(this.stateDir)[0];
    if (!accountId) return;
    await this.startConnectedBot(accountId);
  }

  private async pollLogin(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    while (['waiting', 'scanned'].includes(session.status)) {
      if (Date.now() > session.startedAt + LOGIN_TIMEOUT_MS) {
        session.status = 'expired';
        session.message = '二维码已过期，请重新连接。';
        session.updatedAt = nowIso();
        this.connection = {
          channel: 'weixin',
          connected: false,
          status: 'expired',
          message: session.message,
          updatedAt: nowIso(),
        };
        return;
      }

      try {
        const status = await this.pollQRCodeStatus(
          session.rawQRCode,
          session.currentApiBaseUrl
        );
        await this.applyProviderStatus(session, status);
      } catch (error) {
        session.status = 'failed';
        session.error = error instanceof Error ? error.message : String(error);
        session.message = '微信连接失败，请重新连接。';
        session.updatedAt = nowIso();
        this.connection = {
          channel: 'weixin',
          connected: false,
          status: 'failed',
          message: session.error,
          updatedAt: nowIso(),
        };
        return;
      }

      if (!['waiting', 'scanned'].includes(session.status)) return;
      await sleep(POLL_INTERVAL_MS);
    }
  }

  private async applyProviderStatus(
    session: ActiveLogin,
    status: WeixinStatusResponse
  ): Promise<void> {
    if (status.status === 'wait') {
      session.status = 'waiting';
      session.message = '请使用手机微信扫描二维码。';
      session.updatedAt = nowIso();
      return;
    }

    if (status.status === 'scaned') {
      session.status = 'scanned';
      session.message = '已扫码，请在手机微信上确认。';
      session.updatedAt = nowIso();
      this.connection = {
        channel: 'weixin',
        connected: false,
        status: 'scanned',
        message: session.message,
        updatedAt: nowIso(),
      };
      return;
    }

    if (status.status === 'scaned_but_redirect') {
      if (status.redirect_host) {
        session.currentApiBaseUrl = `https://${status.redirect_host}`;
      }
      session.status = 'scanned';
      session.message = '已扫码，请在手机微信上确认。';
      session.updatedAt = nowIso();
      return;
    }

    if (status.status === 'expired') {
      await this.refreshQRCode(session);
      return;
    }

    if (status.status === 'confirmed') {
      if (!status.bot_token || !status.ilink_bot_id || !status.ilink_user_id) {
        throw new Error('微信确认成功，但登录信息不完整，请重新连接。');
      }

      const accountId = normalizeAccountId(status.ilink_bot_id);
      saveWeixinAccount(this.stateDir, accountId, {
        token: status.bot_token,
        baseUrl: status.baseurl,
        userId: status.ilink_user_id,
      });
      registerWeixinAccount(this.stateDir, accountId);
      session.status = 'confirmed';
      session.accountId = accountId;
      session.message = '微信连接成功。';
      session.updatedAt = nowIso();
      await this.startConnectedBot(accountId);
      return;
    }
  }

  private async refreshQRCode(session: ActiveLogin): Promise<void> {
    session.refreshCount += 1;
    if (session.refreshCount > QR_REFRESH_LIMIT) {
      session.status = 'expired';
      session.message = '二维码已过期，请重新连接。';
      session.updatedAt = nowIso();
      this.connection = {
        channel: 'weixin',
        connected: false,
        status: 'expired',
        message: session.message,
        updatedAt: nowIso(),
      };
      return;
    }

    const qr = await this.fetchQRCode();
    const qrCodeUrl = qr.qrcode_img_content || qr.qrcode;
    if (!qr.qrcode || !qrCodeUrl) {
      throw new Error('微信二维码刷新失败，请重新连接。');
    }

    session.rawQRCode = qr.qrcode;
    session.qrCodeUrl = qrCodeUrl;
    session.qrCodeSvg = await QRCode.toString(qrCodeUrl, {
      type: 'svg',
      margin: 1,
      width: 240,
    });
    session.startedAt = Date.now();
    session.status = 'waiting';
    session.message = '二维码已刷新，请重新扫码。';
    session.updatedAt = nowIso();
  }

  private async startConnectedBot(accountId: string): Promise<void> {
    this.botAbortController?.abort();
    const abortController = new AbortController();
    this.botAbortController = abortController;

    this.connection = {
      channel: 'weixin',
      connected: false,
      status: 'connecting',
      accountId,
      message: '正在启动微信消息接收。',
      updatedAt: nowIso(),
    };

    const agent = this.createAgent();
    const bot = this.startBot(agent, {
      accountId,
      abortSignal: abortController.signal,
      log: () => undefined,
    });
    this.bot = bot;
    this.connection = {
      channel: 'weixin',
      connected: true,
      status: 'connected',
      accountId,
      message: '微信已连接。',
      updatedAt: nowIso(),
    };

    bot.wait().catch((error) => {
      if (abortController.signal.aborted) return;
      this.bot = undefined;
      this.connection = {
        channel: 'weixin',
        connected: false,
        status: 'failed',
        accountId,
        message: error instanceof Error ? error.message : '微信监听已停止。',
        updatedAt: nowIso(),
      };
    });
  }

  private createAgent(): Agent {
    return {
      chat: async (request) => {
        const metadata = request as {
          conversationType?: ChannelConversationType;
          senderId?: string;
          senderName?: string;
        };
        const media = request.media
          ? [
              {
                type: request.media.type,
                filePath: request.media.filePath,
                mimeType: request.media.mimeType,
                fileName: request.media.fileName,
              },
            ]
          : undefined;

        const result = await this.inboundHandler({
          channel: 'weixin',
          conversationType: metadata.conversationType,
          conversationId: request.conversationId,
          senderId: metadata.senderId,
          senderName: metadata.senderName,
          text: request.text || '',
          media,
        });

        return {
          text: result.reply.text,
          media: mediaToChatResponse(result.reply.media),
        };
      },
    };
  }

  private toPublicSession(session: ActiveLogin): WeixinLoginSession {
    return {
      sessionId: session.sessionId,
      status: session.status,
      qrCodeSvg: session.qrCodeSvg,
      qrCodeUrl: session.qrCodeUrl,
      expiresAt: session.expiresAt,
      message: session.message,
      accountId: session.accountId,
      error: session.error,
      updatedAt: session.updatedAt,
    };
  }
}

export function createWeixinLoginManager(options: WeixinLoginManagerOptions) {
  return new WeixinLoginManager(options);
}
