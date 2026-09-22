#!/usr/bin/env node
/**
 * 演示数据种子脚本
 * 作用：把平台从「E2E 测试数据」还原成一家真实公司的样子
 *       1. 清理 E2E 脚本留下的假账号（requester-1712…@example.com）与假需求（报表自动导出工具1712…）；
 *       2. 清空上一次种子写入的演示数据（@aimanager.com），保证脚本可重复执行；
 *       3. 写入一套贴合「智能装备制造企业」场景的数据：人员、需求、认领、共同需求人、
 *          反馈与讨论、Pull Request、附件、通知，并把时间打散到过去 11 个月；
 *       4. 同步在 Gitea 中创建真实账号与仓库（基于仓库模板生成，含 Webhook 与流水线回调），
 *          让需求详情页的仓库地址、反馈对应的 Issue 都能真正点开。
 * 用法：
 *   docker compose exec -T api npm run seed:demo            # 清理 + 重建演示数据
 *   docker compose exec -T api npm run seed:demo -- --keep-e2e      # 保留 E2E 数据
 *   docker compose exec -T api npm run seed:demo -- --skip-gitea    # 只写数据库，不连 Gitea
 * 说明：演示账号统一密码为 Demo@123456（可用环境变量 DEMO_PASSWORD 覆盖），
 *      仅用于内部演示环境，请勿在生产环境执行。
 */
'use strict';

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');

// 复用后端编译产物里的命名规则，保证仓库名/用户名与线上逻辑完全一致
const { buildGiteaUsername, buildRepoName } = require('../dist/common/utils/naming.util');

const prisma = new PrismaClient();

// ============================================================
// 运行参数与环境
// ============================================================
const ARGS = new Set(process.argv.slice(2));
const KEEP_E2E = ARGS.has('--keep-e2e');
const SKIP_GITEA = ARGS.has('--skip-gitea');

/** 演示账号统一密码 */
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'Demo@123456';
/** 平台管理员邮箱（.env 中 ADMIN_EMAIL，演示数据统一使用公司域名） */
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@aimanager.com';
/** 演示数据的邮箱域名 */
const DEMO_DOMAIN = ADMIN_EMAIL.includes('@') ? ADMIN_EMAIL.split('@')[1] : 'aimanager.com';

/** Gitea 容器内网地址与令牌 */
const GITEA_BASE = (process.env.GITEA_INTERNAL_URL || 'http://gitea:3000').replace(/\/$/, '');
const GITEA_TOKEN = process.env.GITEA_API_TOKEN || '';
const GITEA_ORG = process.env.GITEA_ORG || 'projects';
const GITEA_WEBHOOK_SECRET = process.env.GITEA_WEBHOOK_SECRET || '';
const CI_CALLBACK_TOKEN = process.env.CI_CALLBACK_TOKEN || GITEA_WEBHOOK_SECRET;
const SELF_INTERNAL_URL = (process.env.SELF_INTERNAL_URL || 'http://api:4000').replace(/\/$/, '');
/** 附件落盘目录（与后端 upload.dir 一致） */
const UPLOAD_DIR = process.env.UPLOAD_DIR || '/app/uploads';

/** E2E 脚本生成的测试账号：专用测试域名，或历史遗留的 requester-/developer-/watcher- 前缀 */
const E2E_EMAIL_DOMAIN = process.env.E2E_DOMAIN || 'e2e.example.com';
const E2E_EMAIL_PATTERN = /^(requester|developer|watcher)-\d+@example\.com$/i;
/** E2E 脚本生成的仓库名特征（req-1789988718-949a06） */
const E2E_REPO_PATTERN = /^req-\d+(-[0-9a-f]+)?$/i;

const DAY = 24 * 60 * 60 * 1000;

// ============================================================
// 小工具
// ============================================================

/** 确定性伪随机数（保证多次执行结果稳定，便于排查） */
let randomState = 20260922;
function rand() {
  randomState = (randomState * 1103515245 + 12345) & 0x7fffffff;
  return randomState / 0x7fffffff;
}

/** 从数组中确定性地取一项 */
function pick(list) {
  return list[Math.floor(rand() * list.length) % list.length];
}

/** 取 N 天前的时间点 */
function daysAgo(days, hour = 10, minute = 0) {
  const date = new Date(Date.now() - days * DAY);
  date.setHours(hour, minute, 0, 0);
  return date;
}

/** 把日期挪到最近的工作日（周末的项目创建看上去更真实） */
function toWorkday(date) {
  const day = date.getDay();
  if (day === 6) {
    return new Date(date.getTime() - DAY);
  }
  if (day === 0) {
    return new Date(date.getTime() - 2 * DAY);
  }
  return date;
}

/** 打印一行进度 */
function log(message) {
  console.log(`[seed] ${message}`);
}

// ============================================================
// 极简 PNG 生成（仅用于生成演示用的「截图」占位图，避免引入图形库）
// ============================================================
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

/** 计算 PNG 分块校验和 */
function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** 组装一个 PNG 数据块 */
function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

/**
 * 把像素回调渲染成 PNG
 * @param width 宽度
 * @param height 高度
 * @param pixel 像素函数 (x, y) => [r, g, b]
 */
function encodePng(width, height, pixel) {
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * stride;
    raw[rowStart] = 0; // 过滤器类型：None
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = pixel(x, y);
      const offset = rowStart + 1 + x * 3;
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 位深
  ihdr[9] = 2; // 真彩色
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * 生成一张「系统截图」风格的图片：顶部标题栏 + 表格线 + 柱状图
 * @param variant 0 报表类、1 表格类、2 看板类
 */
function makeScreenshotPng(variant) {
  const WIDTH = 720;
  const HEIGHT = 420;
  const HEADER = 46;
  const bg = [245, 247, 250];
  const primary = [22, 119, 255];
  const success = [82, 196, 26];
  const border = [222, 226, 235];
  const bars = variant === 2 ? [0.35, 0.6, 0.45, 0.8, 0.55, 0.7, 0.4, 0.65] : [0.5, 0.72, 0.38, 0.86, 0.6, 0.44, 0.78];
  const barCount = bars.length;
  const chartTop = HEADER + 90;
  const chartBottom = HEIGHT - 60;
  const slot = (WIDTH - 80) / barCount;

  return encodePng(WIDTH, HEIGHT, (x, y) => {
    // 顶部标题栏
    if (y < HEADER) {
      if (x < 18 || x > WIDTH - 18) {
        return primary;
      }
      return primary;
    }
    // 标题占位块（模拟一行小标题文字）
    if (y > HEADER + 20 && y < HEADER + 34 && x > 40 && x < 40 + (variant === 0 ? 210 : 150)) {
      return [180, 190, 205];
    }
    // 表格分隔线
    for (let row = 0; row < 3; row += 1) {
      const lineY = HEADER + 52 + row * 16;
      if (y === lineY && x > 40 && x < WIDTH - 40) {
        return border;
      }
    }
    if (variant === 1 && y > chartTop - 40 && y < HEIGHT - 60) {
      // 表格类：竖向列分隔
      if (x > 40 && x < WIDTH - 40 && (x - 40) % 120 === 0) {
        return border;
      }
    }
    // 柱状图
    if (x > 40 && x < WIDTH - 40 && y > chartTop && y < chartBottom) {
      const index = Math.min(barCount - 1, Math.floor((x - 40) / slot));
      const barHeight = (chartBottom - chartTop) * bars[index];
      const barLeft = 40 + index * slot + slot * 0.18;
      const barRight = 40 + index * slot + slot * 0.82;
      if (x >= barLeft && x <= barRight && y > chartBottom - barHeight) {
        return index % 2 === 0 ? primary : success;
      }
    }
    // 底部基线
    if (y === chartBottom && x > 40 && x < WIDTH - 40) {
      return border;
    }
    return bg;
  });
}

// ============================================================
// 演示数据：人员
// ============================================================
const DEMO_USERS = [
  // 第一批同事：以提出需求为主（同样可以认领别人的需求）
  { key: 'zhangwei', name: '张伟', email: `zhang.wei@${DEMO_DOMAIN}`, department: '生产部', avatar: 'user-01' },
  { key: 'lijing', name: '李静', email: `li.jing@${DEMO_DOMAIN}`, department: '财务部', avatar: 'user-02' },
  { key: 'wangqiang', name: '王强', email: `wang.qiang@${DEMO_DOMAIN}`, department: '质量部', avatar: 'user-03' },
  { key: 'liumin', name: '刘敏', email: `liu.min@${DEMO_DOMAIN}`, department: '人力资源部', avatar: 'user-04' },
  { key: 'chenxiaodong', name: '陈晓东', email: `chen.xiaodong@${DEMO_DOMAIN}`, department: '供应链部', avatar: 'user-05' },
  { key: 'zhaoxue', name: '赵雪', email: `zhao.xue@${DEMO_DOMAIN}`, department: '市场部', avatar: 'user-06' },
  { key: 'xuqian', name: '徐倩', email: `xu.qian@${DEMO_DOMAIN}`, department: '生产部', avatar: 'user-07' },
  { key: 'matao', name: '马涛', email: `ma.tao@${DEMO_DOMAIN}`, department: '设备部', avatar: 'user-08' },
  { key: 'gaoyuan', name: '高媛', email: `gao.yuan@${DEMO_DOMAIN}`, department: '财务部', avatar: 'user-09' },
  { key: 'xieting', name: '谢婷', email: `xie.ting@${DEMO_DOMAIN}`, department: '人力资源部', avatar: 'user-10' },
  // 第二批同事：以认领实现为主（同样可以提自己的需求）
  {
    key: 'zhouhang',
    name: '周航',
    email: `zhou.hang@${DEMO_DOMAIN}`,
    department: '研发中心',
    avatar: 'user-11',
    skills: ['TypeScript', 'NestJS', 'PostgreSQL', 'Docker'],
  },
  {
    key: 'sunyiming',
    name: '孙一鸣',
    email: `sun.yiming@${DEMO_DOMAIN}`,
    department: '信息部',
    avatar: 'user-12',
    skills: ['React', 'TypeScript', 'Ant Design'],
  },
  {
    key: 'wudi',
    name: '吴迪',
    email: `wu.di@${DEMO_DOMAIN}`,
    department: '研发中心',
    avatar: 'user-13',
    skills: ['Python', '数据分析', 'Excel 自动化'],
  },
  {
    key: 'zhengkai',
    name: '郑凯',
    email: `zheng.kai@${DEMO_DOMAIN}`,
    department: '信息部',
    avatar: 'user-14',
    skills: ['Java', 'Spring Boot', 'CI/CD'],
  },
  {
    key: 'linfang',
    name: '林芳',
    email: `lin.fang@${DEMO_DOMAIN}`,
    department: '研发中心',
    avatar: 'user-15',
    skills: ['Vue', '前端', '移动端'],
  },
  {
    key: 'huanglei',
    name: '黄磊',
    email: `huang.lei@${DEMO_DOMAIN}`,
    department: '信息部',
    avatar: 'user-16',
    skills: ['Go', 'Kubernetes', '运维'],
  },
  {
    key: 'hejun',
    name: '何俊',
    email: `he.jun@${DEMO_DOMAIN}`,
    department: '研发中心',
    avatar: 'user-17',
    skills: ['嵌入式', 'C++', '设备通信'],
  },
  {
    key: 'luobin',
    name: '罗斌',
    email: `luo.bin@${DEMO_DOMAIN}`,
    department: '质量部',
    avatar: 'user-18',
    skills: ['Python', '自动化测试', '报表'],
  },
];

/** 待审核账号：让「用户审核」页面也有真实内容 */
const PENDING_USERS = [
  { key: 'dengchao', name: '邓超', email: `deng.chao@${DEMO_DOMAIN}`, department: '生产部', avatar: 'user-15', daysAgo: 2 },
  { key: 'shenmeng', name: '沈梦', email: `shen.meng@${DEMO_DOMAIN}`, department: '市场部', avatar: 'user-16', daysAgo: 1 },
];

/** 本脚本管理的演示账号邮箱：精确匹配，避免误删同事自己注册的账号 */
const DEMO_EMAILS = new Set([...DEMO_USERS, ...PENDING_USERS].map((item) => item.email));

// ============================================================
// 演示数据：需求（含认领、共同需求人、反馈、PR、附件）
// ============================================================
const DEMO_PROJECTS = [
  {
    key: 'shengchan-ribao',
    title: '生产日报自动汇总并推送企业微信',
    creator: 'zhangwei',
    status: 'OPEN',
    tags: ['报表', '自动化', '企业微信'],
    avatar: 'task-01',
    daysAgo: 6,
    expectedInDays: 24,
    description:
      '目前车间每天下班前要把 3 条产线的产量、良率、停机时间手工汇总到一张 Excel 里，再由专人发到生产管理群，通常要花 40 分钟以上，遇到加班经常漏发。希望把这几张表自动汇总，按固定时间推送到企业微信「生产日报」群。',
    acceptanceCriteria:
      '1. 每天 17:30 自动汇总当日各产线产量、良率、停机时长；\n2. 汇总结果推送到指定企业微信群，格式与现有日报模板一致；\n3. 某条产线未填报时，在群里提示缺失项；\n4. 支持手工补跑指定日期的日报。',
    requesters: ['xuqian', 'matao'],
  },
  {
    key: 'shebei-dianjian',
    title: '设备点检记录电子化，替代纸质点检表',
    creator: 'matao',
    status: 'OPEN',
    tags: ['移动端', '设备管理'],
    avatar: 'task-04',
    daysAgo: 13,
    expectedInDays: 35,
    description:
      '设备点检现在靠纸质表格，工人勾选后交班组长，一个月下来一堆纸，既不好查也没法统计漏检率。希望做成手机端点检：扫码进入对应设备，逐项打勾，异常项拍照上传。',
    acceptanceCriteria:
      '1. 手机浏览器可直接打开，无需安装 App；\n2. 扫描设备二维码定位设备并带出点检项；\n3. 异常项必须上传现场照片并填写说明；\n4. 可按设备/日期导出点检记录，自动统计漏检率。',
    requesters: ['zhangwei'],
    attachments: [
      { uploader: 'matao', kind: 'IMAGE', name: '点检表现状.png', image: 1 },
      { uploader: 'matao', kind: 'FILE', name: '点检项目清单.txt', text: '1 号冲床点检项目：\n- 润滑系统油位\n- 气压是否正常（0.5±0.05MPa）\n- 安全光栅是否灵敏\n- 模具紧固螺栓\n- 设备表面清洁\n' },
    ],
  },
  {
    key: 'gongyingshang-lailiao',
    title: '供应商来料质检数据线上登记与追溯',
    creator: 'wangqiang',
    status: 'OPEN',
    tags: ['质量管理', '数据追溯'],
    avatar: 'task-07',
    daysAgo: 21,
    expectedInDays: 45,
    description:
      '来料检验结果记在检验员的记录本上，客户审厂时要追溯某个批次的检验数据非常吃力，经常要翻一整天的纸质记录。希望把登记与查询搬到线上。',
    acceptanceCriteria:
      '1. 按批次登记来料检验结果（合格 / 让步接收 / 退货）；\n2. 支持按供应商、料号、批次号检索检验记录；\n3. 可导出单个批次的完整检验报告；\n4. 判定不合格时自动通知采购与供应商对接人。',
    requesters: ['chenxiaodong'],
    attachments: [{ uploader: 'wangqiang', kind: 'IMAGE', name: '来料检验记录格式.png', image: 0 }],
  },
  {
    key: 'tiaoxiu-hesuan',
    title: '员工调休与加班时长自动核算',
    creator: 'liumin',
    status: 'OPEN',
    tags: ['人事', '考勤'],
    avatar: 'task-02',
    daysAgo: 27,
    expectedInDays: 40,
    description:
      '加班时长在考勤机里、调休申请在钉钉里，月底核对要两边拿来手工比对，人多时容易算错，员工也常来问剩余调休天数。',
    acceptanceCriteria:
      '1. 每日同步考勤机加班数据与调休申请；\n2. 自动计算每人剩余调休时长，员工可自助查询；\n3. 月底生成部门加班统计表；\n4. 两边数据不一致时标记出来供人事核对。',
  },
  {
    key: 'kesu-gongdan',
    title: '客户投诉工单响应时效看板',
    creator: 'zhaoxue',
    status: 'OPEN',
    tags: ['看板', '客服'],
    avatar: 'task-09',
    daysAgo: 34,
    expectedInDays: 50,
    description:
      '客户投诉通过邮件和电话进来，散在不同人手里，管理层想知道「平均多久响应、有没有超时」只能靠人工统计。',
    acceptanceCriteria:
      '1. 投诉登记后自动计时，超过 4 小时未响应标红；\n2. 看板展示各状态工单数量与平均响应时长；\n3. 按周/月导出统计表；\n4. 支持把工单指派给具体责任人。',
    requesters: ['wangqiang'],
  },
  {
    key: 'cangku-kuwei',
    title: '仓库库位可视化查询',
    creator: 'chenxiaodong',
    owner: 'zhouhang',
    status: 'CLAIMED',
    tags: ['仓储', '可视化'],
    avatar: 'task-03',
    daysAgo: 40,
    claimedDaysAgo: 18,
    expectedInDays: 30,
    description:
      '仓库现有 12 个库区、上千个库位，新来的仓管找料要问老员工。希望有个页面能按料号查到具体库位，并显示当前是否有库存。',
    acceptanceCriteria:
      '1. 按料号/名称模糊查询，返回库位编号与库存数量；\n2. 库区平面示意图上高亮对应库位；\n3. 支持手机端使用（仓管在现场查）。',
    requesters: ['matao'],
    members: ['sunyiming'],
    claimRemark: '先做查询接口和库位示意图，两周内出可用版本',
    feedbacks: [
      {
        author: 'chenxiaodong',
        type: 'IMPROVEMENT',
        status: 'OPEN',
        daysAgo: 5,
        title: '库位示意图能不能支持放大',
        content: '现在的示意图在手机上看着太小，库位编号挤在一起看不清，希望支持双指放大或者点击展开。',
      },
    ],
  },
  {
    key: 'chailv-baoxiao',
    title: '差旅报销单据智能校验',
    creator: 'lijing',
    owner: 'sunyiming',
    status: 'CLAIMED',
    tags: ['财务', '规则校验'],
    avatar: 'task-05',
    daysAgo: 47,
    claimedDaysAgo: 26,
    expectedInDays: 28,
    description:
      '报销单退单率接近三成，多数是发票抬头写错、金额超标准、缺少行程单这类可以自动发现的问题，财务每天要花大量时间解释。',
    acceptanceCriteria:
      '1. 提交时校验发票抬头与金额是否超过差旅标准；\n2. 超标项给出明确提示并注明制度条款出处；\n3. 校验通过的单据才进入审批流。',
    members: ['zhouhang'],
    claimRemark: '先把校验规则整理出来，再做接口',
    feedbacks: [
      {
        author: 'lijing',
        type: 'QUESTION',
        status: 'OPEN',
        daysAgo: 9,
        title: '差旅标准是按哪个版本的制度',
        content: '今年 4 月修订过一次差旅标准，住宿上限有调整，校验规则里用的是哪一版？',
      },
    ],
  },
  {
    key: 'shengchan-baobiao-daochu',
    title: '生产报表自动导出与定时推送',
    creator: 'xuqian',
    owner: 'wudi',
    status: 'DEVELOPING',
    tags: ['报表', '自动化'],
    avatar: 'task-06',
    daysAgo: 96,
    claimedDaysAgo: 74,
    expectedInDays: 10,
    description:
      '每天早上 7 点前要把前一天的产量、不良率、设备稼动率整理成日报发给厂长和各车间主任，现在全靠人工从 MES 导出再粘贴，容易漏项。',
    acceptanceCriteria:
      '1. 一键导出当日报表（Excel）；\n2. 可按固定时间自动推送给指定同事；\n3. 报表模板与现有格式保持一致。',
    requesters: ['zhangwei'],
    members: ['linfang'],
    claimRemark: '报表逻辑我比较熟，先做导出再做推送',
    attachments: [
      { uploader: 'xuqian', kind: 'IMAGE', name: '生产日报样张.png', image: 0 },
      { uploader: 'xuqian', kind: 'FILE', name: '报表字段说明.md', text: '# 生产日报字段说明\n\n| 字段 | 来源 |\n| --- | --- |\n| 产量 | MES 报工记录按日汇总 |\n| 不良率 | 质检判定结果 / 产量 |\n| 稼动率 | 设备实际运行时长 / 计划时长 |\n| 停机时长 | 设备停机登记表 |\n' },
    ],
    pullReqs: [
      { author: 'wudi', title: 'feat: 完成报表查询与 Excel 导出', headBranch: 'feat/report-export', merged: true, ciStatus: 'success', daysAgo: 62 },
      { author: 'wudi', title: 'feat: 增加定时推送与企业微信机器人', headBranch: 'feat/schedule-push', merged: true, ciStatus: 'success', daysAgo: 41 },
      { author: 'linfang', title: 'fix: 修正跨零点班次的日期归属', headBranch: 'fix/night-shift-date', merged: false, ciStatus: 'pending', daysAgo: 3 },
    ],
    feedbacks: [
      {
        author: 'xuqian',
        type: 'BUG',
        status: 'OPEN',
        daysAgo: 4,
        title: '导出的报表缺少合计行',
        content: '导出昨天的日报，最后没有合计行，厂长看的时候要自己加，麻烦补上。',
      },
      {
        author: 'zhangwei',
        type: 'IMPROVEMENT',
        status: 'PROCESSING',
        daysAgo: 12,
        title: '希望支持按周导出，而不只是按天',
        content: '每周一的生产例会要用周报，现在是手动把 7 天的日报拼起来，能不能直接按周导出？',
        comments: [{ author: 'wudi', daysAgo: 11, content: '可以，周报按自然周（周一至周日）汇总，这周内加上。' }],
      },
      {
        author: 'xuqian',
        type: 'QUESTION',
        status: 'RESOLVED',
        daysAgo: 20,
        title: '推送时间可以改成 17:00 吗',
        content: '我们车间 16:30 就下班了，17:30 推送的话没人看，能不能提前一点？',
        comments: [
          { author: 'wudi', daysAgo: 19, content: '推送时间已经做成可配置，先给你这条产线改成 17:00。' },
          { author: 'xuqian', daysAgo: 18, content: '收到了，谢谢！' },
        ],
      },
    ],
  },
  {
    key: 'zhiliang-yichang',
    title: '质量异常闭环管理',
    creator: 'wangqiang',
    owner: 'zhengkai',
    status: 'DEVELOPING',
    tags: ['质量管理', '流程'],
    avatar: 'task-08',
    daysAgo: 110,
    claimedDaysAgo: 88,
    expectedInDays: 20,
    description:
      '质量异常从发现到关闭目前靠微信群喊，异常单的开单、原因分析、纠正措施、验证关闭四个环节经常断档，追溯时找不到完整记录。',
    acceptanceCriteria:
      '1. 异常单按「开单-分析-纠正-验证-关闭」流程流转；\n2. 每个环节记录责任人与时间；\n3. 超期未关闭的异常单自动提醒；\n4. 支持按产品线统计异常数量与关闭时长。',
    requesters: ['zhangwei', 'luobin'],
    members: ['luobin'],
    claimRemark: '流程我梳理过，先跟质量部确认状态定义',
    pullReqs: [
      { author: 'zhengkai', title: 'feat: 异常单流程与状态流转', headBranch: 'feat/abnormal-flow', merged: true, ciStatus: 'success', daysAgo: 70 },
      { author: 'zhengkai', title: 'feat: 超期提醒与统计报表', headBranch: 'feat/overdue-reminder', merged: false, ciStatus: 'failure', daysAgo: 2 },
    ],
    feedbacks: [
      {
        author: 'wangqiang',
        type: 'BUG',
        status: 'OPEN',
        daysAgo: 6,
        title: '异常单附件上传后看不到缩略图',
        content: '上传的不良品照片只能看到文件名，要点开才能看，希望能直接显示缩略图。',
      },
      {
        author: 'luobin',
        type: 'IMPROVEMENT',
        status: 'PROCESSING',
        daysAgo: 15,
        title: '希望增加按产品线筛选',
        content: '我们同时管三条产品线，现在列表混在一起，找自己那条线的异常单比较费劲。',
        comments: [{ author: 'zhengkai', daysAgo: 14, content: '已加入本期范围，和统计报表一起上线。' }],
      },
      {
        author: 'wangqiang',
        type: 'BUG',
        status: 'RESOLVED',
        daysAgo: 30,
        title: '关闭异常单时提示超时错误',
        content: '点关闭按钮转很久，最后提示 504，刷新后状态其实已经关闭了。',
        comments: [{ author: 'zhengkai', daysAgo: 28, content: '是验证环节调用外部接口超时导致的，已加超时兜底。' }],
      },
    ],
  },
  {
    key: 'gongdan-paigong',
    title: '工单派工与进度看板',
    creator: 'zhangwei',
    owner: 'linfang',
    status: 'DEVELOPING',
    tags: ['看板', '生产管理'],
    avatar: 'task-10',
    daysAgo: 68,
    claimedDaysAgo: 55,
    expectedInDays: 25,
    description:
      '车间派工靠班组长口头安排，谁在做什么、做到哪一步只有班组自己清楚，管理层看不到整体进度。',
    acceptanceCriteria:
      '1. 班组长可把工单派给具体工人；\n2. 工人端可查看自己的待办工单并标记开始/完成；\n3. 看板展示各工单状态与预计完成时间。',
    requesters: ['xuqian'],
    members: ['sunyiming'],
    claimRemark: '先做主流程，看板后面迭代',
    pullReqs: [
      { author: 'linfang', title: 'feat: 派工看板与工单状态流转', headBranch: 'feat/dispatch-board', merged: false, ciStatus: 'success', daysAgo: 8 },
    ],
    feedbacks: [
      {
        author: 'zhangwei',
        type: 'BUG',
        status: 'OPEN',
        daysAgo: 3,
        title: '工人端看不到刚派的工单，需要刷新',
        content: '班组长刚派完工单，工人手机上要退出去重进才能看到，希望能自动刷新。',
      },
      {
        author: 'matao',
        type: 'QUESTION',
        status: 'CLOSED',
        daysAgo: 22,
        title: '这个看板能用在设备维修班吗',
        content: '维修班也想用这种方式派活，工单类型不一样，能不能配置？',
        comments: [{ author: 'zhangwei', daysAgo: 21, content: '先在生产班用完这一版，稳定后再和你们对需求。' }],
      },
    ],
  },
  {
    key: 'wuliao-qitao',
    title: '物料齐套率分析与预警',
    creator: 'chenxiaodong',
    owner: 'huanglei',
    status: 'DEVELOPING',
    tags: ['供应链', '预警'],
    avatar: 'task-11',
    daysAgo: 74,
    claimedDaysAgo: 61,
    expectedInDays: 18,
    description:
      '上线前才发现缺料是常态，采购和计划互相扯皮。希望提前 3 天按工单算出齐套率，缺料项直接推给采购员。',
    acceptanceCriteria:
      '1. 按工单计算齐套率与缺料清单；\n2. 预计影响上线时提前 3 天预警；\n3. 预警推送给对应采购员。',
    requesters: ['zhangwei'],
    members: ['zhengkai'],
    claimRemark: '库存接口已有，主要是缺料预警的推送策略',
    pullReqs: [
      { author: 'huanglei', title: 'feat: 齐套率计算接口', headBranch: 'feat/kit-rate', merged: true, ciStatus: 'success', daysAgo: 35 },
      { author: 'huanglei', title: 'feat: 缺料预警推送', headBranch: 'feat/shortage-alert', merged: false, ciStatus: 'success', daysAgo: 5 },
    ],
    feedbacks: [
      {
        author: 'chenxiaodong',
        type: 'BUG',
        status: 'RESOLVED',
        daysAgo: 16,
        title: '齐套率算出来 100%，实际缺 2 个物料',
        content: '工单 GD20260901 明明缺 2 个轴承座，系统显示齐套率 100%。',
        comments: [{ author: 'huanglei', daysAgo: 15, content: '是替代料没参与计算，已修复，麻烦再核一遍。' }],
      },
    ],
  },
  {
    key: 'shebei-guzhang-zhishiku',
    title: '设备故障知识库检索',
    creator: 'matao',
    owner: 'hejun',
    status: 'DEVELOPING',
    tags: ['知识库', '设备管理'],
    avatar: 'task-12',
    daysAgo: 52,
    claimedDaysAgo: 38,
    expectedInDays: 22,
    description:
      '老师傅修设备的经验都在脑子里，新人遇到同类故障要重新摸索。希望把历史维修记录整理成可检索的知识库。',
    acceptanceCriteria:
      '1. 按设备型号/故障现象检索历史维修记录；\n2. 记录包含现象、原因、处理方法；\n3. 支持上传现场照片。',
    requesters: ['zhangwei', 'xuqian'],
    members: ['luobin'],
    claimRemark: '先把维修记录表结构定下来',
    pullReqs: [
      { author: 'hejun', title: 'feat: 知识库检索与录入', headBranch: 'feat/kb-search', merged: true, ciStatus: 'success', daysAgo: 20 },
      { author: 'hejun', title: 'feat: 按设备型号聚合故障', headBranch: 'feat/kb-by-model', merged: false, ciStatus: 'pending', daysAgo: 1 },
    ],
  },
  {
    key: 'ruzhi-cailiao',
    title: '员工入职材料线上收集',
    creator: 'xieting',
    owner: 'sunyiming',
    status: 'RELEASED',
    tags: ['人事', '流程'],
    avatar: 'task-01',
    daysAgo: 190,
    claimedDaysAgo: 170,
    releasedDaysAgo: 120,
    description: '新员工入职要交身份证、学历证明、体检报告等 8 类材料，之前靠邮件来回催，HR 要反复确认缺哪些。',
    acceptanceCriteria: '1. 新员工收到链接后可自助上传各类材料；\n2. HR 端显示每人材料齐备情况；\n3. 缺失材料自动提醒。',
    members: ['zhouhang'],
    claimRemark: '表单类需求比较直接，两周能出初版',
    pullReqs: [
      { author: 'sunyiming', title: 'feat: 入职材料上传与清单', headBranch: 'feat/onboard-upload', merged: true, ciStatus: 'success', daysAgo: 160 },
      { author: 'sunyiming', title: 'feat: 材料缺失提醒', headBranch: 'feat/onboard-remind', merged: true, ciStatus: 'success', daysAgo: 140 },
      { author: 'zhouhang', title: 'fix: 修复大文件上传失败', headBranch: 'fix/upload-limit', merged: true, ciStatus: 'success', daysAgo: 128 },
    ],
    feedbacks: [
      {
        author: 'xieting',
        type: 'BUG',
        status: 'RESOLVED',
        daysAgo: 110,
        title: '上传体检报告时提示格式不支持',
        content: '医院给的报告是 PDF，上传时提示格式不支持，但 PDF 应该在允许范围内。',
        comments: [{ author: 'sunyiming', daysAgo: 109, content: '大小写后缀判断的问题，已修复。' }],
      },
    ],
  },
  {
    key: 'baoxiao-jindu',
    title: '报销进度自助查询',
    creator: 'gaoyuan',
    owner: 'zhouhang',
    status: 'RELEASED',
    tags: ['财务', '自助查询'],
    avatar: 'task-02',
    daysAgo: 205,
    claimedDaysAgo: 185,
    releasedDaysAgo: 140,
    description: '员工常问「我的报销到哪一步了」，财务要一个个查。希望员工自己能查到当前审批节点。',
    acceptanceCriteria: '1. 按单据号或提交时间查询当前审批节点；\n2. 显示预计到账时间；\n3. 支持查看历史报销记录。',
    members: ['lijing'],
    claimRemark: '审批流是现成的，主要是前端页面',
    pullReqs: [
      { author: 'zhouhang', title: 'feat: 报销进度查询页面', headBranch: 'feat/expense-progress', merged: true, ciStatus: 'success', daysAgo: 170 },
      { author: 'zhouhang', title: 'feat: 对接审批流节点', headBranch: 'feat/approval-node', merged: true, ciStatus: 'success', daysAgo: 150 },
    ],
  },
  {
    key: 'chuchang-baogao',
    title: '出厂检验报告自动生成',
    creator: 'wangqiang',
    owner: 'luobin',
    status: 'RELEASED',
    tags: ['质量管理', '报表'],
    avatar: 'task-03',
    daysAgo: 165,
    claimedDaysAgo: 148,
    releasedDaysAgo: 95,
    description: '每批产品出厂要出一份检验报告，格式固定但数据要手工填，一份要 20 分钟，旺季一天十几批。',
    acceptanceCriteria: '1. 录入检验数据后一键生成 PDF 报告；\n2. 报告模板符合客户要求；\n3. 自动按批次号归档，可随时下载。',
    requesters: ['zhangwei'],
    members: ['wudi'],
    claimRemark: 'PDF 模板需要质量部提供一份样例',
    pullReqs: [
      { author: 'luobin', title: 'feat: PDF 报告模板与生成', headBranch: 'feat/inspection-pdf', merged: true, ciStatus: 'success', daysAgo: 130 },
      { author: 'luobin', title: 'fix: 修正报告日期格式', headBranch: 'fix/report-date', merged: true, ciStatus: 'success', daysAgo: 105 },
    ],
    feedbacks: [
      {
        author: 'wangqiang',
        type: 'IMPROVEMENT',
        status: 'RESOLVED',
        daysAgo: 88,
        title: '报告里希望加上检验员签名',
        content: '客户要求报告上有检验员签名，现在只有打印出来的名字。',
        comments: [{ author: 'luobin', daysAgo: 86, content: '已支持上传签名图片并自动贴到报告右下角。' }],
      },
    ],
  },
  // ---- 历史项目：让协作热力图与统计更像长期积累 ----
  {
    key: 'chuangjian-wenshidu',
    title: '车间温湿度记录表电子化',
    creator: 'xuqian',
    owner: 'hejun',
    status: 'RELEASED',
    tags: ['生产管理', '记录'],
    avatar: 'task-04',
    daysAgo: 320,
    claimedDaysAgo: 305,
    releasedDaysAgo: 268,
    description: '洁净车间每两小时要记录一次温湿度，纸质表容易补记，客户审核时会质疑数据真实性。',
    acceptanceCriteria: '1. 手机扫码填写温湿度；\n2. 记录带时间戳不可修改；\n3. 超标自动提醒班组长。',
    members: ['zhangwei'],
    claimRemark: '用现成的表单引擎做，成本不高',
    pullReqs: [
      { author: 'hejun', title: 'feat: 温湿度记录表单', headBranch: 'feat/env-record', merged: true, ciStatus: 'success', daysAgo: 290 },
    ],
  },
  {
    key: 'songhuodan-saoma',
    title: '供应商送货单扫码入库',
    creator: 'chenxiaodong',
    owner: 'zhengkai',
    status: 'RELEASED',
    tags: ['供应链', '扫码'],
    avatar: 'task-05',
    daysAgo: 290,
    claimedDaysAgo: 276,
    releasedDaysAgo: 240,
    description: '供应商送货单是纸质的，仓管要手工录一遍系统，一天最多录 60 单，容易录错数量和批次。',
    acceptanceCriteria: '1. 扫送货单二维码带出明细；\n2. 支持修改实收数量；\n3. 确认后直接生成入库单。',
    members: ['huanglei'],
    claimRemark: '需要供应商配合生成二维码，先做内部流程',
    pullReqs: [
      { author: 'zhengkai', title: 'feat: 送货单扫码入库', headBranch: 'feat/asn-scan', merged: true, ciStatus: 'success', daysAgo: 255 },
      { author: 'zhengkai', title: 'feat: 入库单生成与打印', headBranch: 'feat/inbound-print', merged: true, ciStatus: 'success', daysAgo: 246 },
    ],
  },
  {
    key: 'zhiliang-zhoubao',
    title: '质量周报自动生成',
    creator: 'wangqiang',
    owner: 'luobin',
    status: 'RELEASED',
    tags: ['质量管理', '报表'],
    avatar: 'task-06',
    daysAgo: 262,
    claimedDaysAgo: 250,
    releasedDaysAgo: 210,
    description: '每周一要给管理层出质量周报，包含不良率趋势、Top5 不良项、客户投诉，现在是手工拼 PPT。',
    acceptanceCriteria: '1. 自动汇总本周质量数据；\n2. 输出含图表的周报文档；\n3. 支持按产品线拆分。',
    requesters: ['zhangwei'],
    members: ['wudi'],
    claimRemark: '数据源和报表模块可以复用',
    pullReqs: [
      { author: 'luobin', title: 'feat: 质量周报数据汇总', headBranch: 'feat/weekly-quality', merged: true, ciStatus: 'success', daysAgo: 226 },
      { author: 'luobin', title: 'feat: 周报图表输出', headBranch: 'feat/weekly-chart', merged: true, ciStatus: 'success', daysAgo: 214 },
    ],
    feedbacks: [
      {
        author: 'wangqiang',
        type: 'IMPROVEMENT',
        status: 'RESOLVED',
        daysAgo: 200,
        title: '周报里的不良率趋势希望能按周而不是按天',
        content: '现在趋势图是每天的，看周报时更想看逐周趋势。',
        comments: [{ author: 'luobin', daysAgo: 198, content: '已增加按周聚合的开关。' }],
      },
    ],
  },
  {
    key: 'jineng-juzhen',
    title: '员工技能矩阵与培训记录',
    creator: 'xieting',
    owner: 'linfang',
    status: 'RELEASED',
    tags: ['人事', '培训'],
    avatar: 'task-07',
    daysAgo: 230,
    claimedDaysAgo: 218,
    releasedDaysAgo: 180,
    description: '车间技能矩阵目前是 Excel 维护，谁有哪张上岗证、什么时候到期，靠人事手工记。',
    acceptanceCriteria: '1. 维护员工技能与持证信息；\n2. 证书到期前提醒本人与主管；\n3. 按班组查看技能覆盖情况。',
    members: ['liumin'],
    claimRemark: '证书到期提醒是关键功能',
    pullReqs: [
      { author: 'linfang', title: 'feat: 技能矩阵与持证记录', headBranch: 'feat/skill-matrix', merged: true, ciStatus: 'success', daysAgo: 195 },
    ],
  },
  {
    key: 'beijian-yujing',
    title: '备件库存预警提醒',
    creator: 'matao',
    owner: 'huanglei',
    status: 'RELEASED',
    tags: ['设备管理', '预警'],
    avatar: 'task-08',
    daysAgo: 205,
    claimedDaysAgo: 194,
    releasedDaysAgo: 160,
    description: '关键备件到安全库存以下没人知道，等设备坏了才发现没备件，采购要等一周。',
    acceptanceCriteria: '1. 备件低于安全库存时提醒；\n2. 提醒推送设备主管与采购员；\n3. 显示近 3 个月消耗量。',
    members: ['chenxiaodong'],
    claimRemark: '预警逻辑和缺料预警类似',
    pullReqs: [
      { author: 'huanglei', title: 'feat: 备件安全库存预警', headBranch: 'feat/spare-part-alert', merged: true, ciStatus: 'success', daysAgo: 172 },
    ],
  },
  {
    key: 'huiyi-jiyao',
    title: '生产会议纪要归档检索',
    creator: 'zhangwei',
    status: 'CLOSED',
    tags: ['知识库'],
    avatar: 'task-09',
    daysAgo: 185,
    closedDaysAgo: 150,
    description:
      '生产例会的纪要散在微信群和邮件里，想查某次决议只能翻聊天记录。\n\n（已关闭：公司统一改用飞书文档归档会议纪要，该需求不再开发）',
    acceptanceCriteria: '1. 纪要统一归档；\n2. 支持按关键字检索。',
  },
];

// ============================================================
// 清理逻辑
// ============================================================

/**
 * 找出需要清理的账号：E2E 脚本生成的假账号 + 上一次写入的演示账号
 * 管理员账号始终保留
 */
async function collectObsoleteUsers() {
  const users = await prisma.user.findMany({
    select: { id: true, email: true, name: true, role: true, giteaUsername: true },
  });
  const targets = users.filter((user) => {
    if (user.email === ADMIN_EMAIL || user.role === 'ADMIN') {
      return false;
    }
    if (DEMO_EMAILS.has(user.email)) {
      return true; // 上一次写入的演示账号
    }
    if (!KEEP_E2E && (user.email.endsWith(`@${E2E_EMAIL_DOMAIN}`) || E2E_EMAIL_PATTERN.test(user.email))) {
      return true; // E2E 脚本产生的测试账号
    }
    return false;
  });
  return targets;
}

/** 收集需要一并删除的 Gitea 仓库与账号 */
async function collectGiteaTargets(userIds) {
  const projects = await prisma.project.findMany({
    where: { OR: [{ creatorId: { in: userIds } }, { ownerId: { in: userIds } }] },
    select: { repoName: true },
  });
  return projects.map((item) => item.repoName).filter(Boolean);
}

// ============================================================
// Gitea 接口
// ============================================================

/** 调用 Gitea API；404 时返回 null，其余错误抛出 */
async function giteaRequest(apiPath, options = {}) {
  const { method = 'GET', body, allow404 = false } = options;
  const url = `${GITEA_BASE}${apiPath}`;
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `token ${GITEA_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (response.status === 404 && allow404) {
    return null;
  }
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Gitea ${method} ${apiPath} -> ${response.status} ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : null;
}

/** 确保 Gitea 账号存在（演示账号使用统一密码，且不强制改密） */
async function ensureGiteaUser({ username, email, name }) {
  const existing = await giteaRequest(`/api/v1/users/${encodeURIComponent(username)}`, { allow404: true });
  if (existing) {
    return false;
  }
  await giteaRequest('/api/v1/admin/users', {
    method: 'POST',
    body: {
      username,
      email,
      password: DEMO_PASSWORD,
      full_name: name,
      must_change_password: false,
      send_notify: false,
    },
  });
  return true;
}

/** 基于仓库模板生成项目仓库；已存在则跳过 */
async function ensureRepoFromTemplate(repoName, description) {
  const existing = await giteaRequest(`/api/v1/repos/${GITEA_ORG}/${repoName}`, { allow404: true });
  if (existing) {
    return false;
  }
  await giteaRequest(`/api/v1/repos/${GITEA_ORG}/repo-template/generate`, {
    method: 'POST',
    body: {
      owner: GITEA_ORG,
      name: repoName,
      description,
      private: true,
      // 必须显式勾选要复制的内容，否则 Gitea 返回 422「must select at least one template item」
      git_content: true,
      topics: true,
      labels: true,
      webhooks: false,
      avatar: false,
    },
  });
  return true;
}

/** 授予仓库写权限 */
async function addCollaborator(repoName, username) {
  await giteaRequest(
    `/api/v1/repos/${GITEA_ORG}/${repoName}/collaborators/${encodeURIComponent(username)}`,
    { method: 'PUT', body: { permission: 'write' } },
  );
}

/** 配置仓库 Webhook（与后端 ensureWebhook 保持一致） */
async function ensureWebhook(repoName) {
  const target = `${SELF_INTERNAL_URL}/api/webhooks/gitea`;
  const hookConfig = {
    type: 'gitea',
    active: true,
    branch_filter: '*',
    config: { url: target, content_type: 'json', http_method: 'post', secret: GITEA_WEBHOOK_SECRET },
    events: ['push', 'create', 'delete', 'issues', 'issue_comment', 'pull_request', 'release'],
  };
  const hooks = await giteaRequest(`/api/v1/repos/${GITEA_ORG}/${repoName}/hooks`, { allow404: true });
  const matched = (hooks || []).find((hook) => hook.config && hook.config.url === target);
  if (matched) {
    await giteaRequest(`/api/v1/repos/${GITEA_ORG}/${repoName}/hooks/${matched.id}`, {
      method: 'PATCH',
      body: hookConfig,
    });
    return;
  }
  await giteaRequest(`/api/v1/repos/${GITEA_ORG}/${repoName}/hooks`, { method: 'POST', body: hookConfig });
}

/** 把流水线回调地址与令牌写入 workflow（与后端 configureCiReporting 保持一致） */
async function configureCiReporting(repoName) {
  if (!CI_CALLBACK_TOKEN) {
    return;
  }
  const callbackUrl = `${SELF_INTERNAL_URL}/api/webhooks/ci`;
  for (const file of ['.gitea/workflows/ci.yml', '.gitea/workflows/release.yml']) {
    const existing = await giteaRequest(
      `/api/v1/repos/${GITEA_ORG}/${repoName}/contents/${file}?ref=main`,
      { allow404: true },
    );
    if (!existing || !existing.content) {
      continue;
    }
    const decoded = Buffer.from(existing.content, 'base64').toString('utf8');
    if (!decoded.includes('__CI_CALLBACK_URL__')) {
      continue;
    }
    const updated = decoded
      .split('__CI_CALLBACK_URL__')
      .join(callbackUrl)
      .split('__CI_CALLBACK_TOKEN__')
      .join(CI_CALLBACK_TOKEN);
    await giteaRequest(`/api/v1/repos/${GITEA_ORG}/${repoName}/contents/${file}`, {
      method: 'PUT',
      body: {
        content: Buffer.from(updated, 'utf8').toString('base64'),
        sha: existing.sha,
        branch: 'main',
        message: 'chore(ci): 配置流水线状态回调',
      },
    });
  }
}

/** 创建反馈对应的 Issue（标签不存在时自动创建） */
async function createIssue(repoName, { title, body, labels }) {
  const labelIds = [];
  if (labels && labels.length > 0) {
    const existing = (await giteaRequest(`/api/v1/repos/${GITEA_ORG}/${repoName}/labels?limit=100`, { allow404: true })) || [];
    for (const name of labels) {
      let matched = existing.find((label) => label.name.toLowerCase() === name.toLowerCase());
      if (!matched) {
        matched = await giteaRequest(`/api/v1/repos/${GITEA_ORG}/${repoName}/labels`, {
          method: 'POST',
          body: { name, color: '#1f6feb' },
        });
        existing.push(matched);
      }
      labelIds.push(matched.id);
    }
  }
  return giteaRequest(`/api/v1/repos/${GITEA_ORG}/${repoName}/issues`, {
    method: 'POST',
    body: { title, body, labels: labelIds.length > 0 ? labelIds : undefined },
  });
}

/** 在 Issue 下追加一条评论 */
async function createIssueComment(repoName, issueNumber, body) {
  await giteaRequest(`/api/v1/repos/${GITEA_ORG}/${repoName}/issues/${issueNumber}/comments`, {
    method: 'POST',
    body: { body },
  });
}

/** 删除 Gitea 仓库（失败只告警） */
async function deleteRepo(repoName) {
  try {
    await giteaRequest(`/api/v1/repos/${GITEA_ORG}/${repoName}`, { method: 'DELETE', allow404: true });
  } catch (error) {
    log(`  跳过删除仓库 ${repoName}: ${error.message}`);
  }
}

/** 删除 Gitea 账号（失败只告警） */
async function deleteUser(username) {
  try {
    await giteaRequest(`/api/v1/admin/users/${encodeURIComponent(username)}`, { method: 'DELETE', allow404: true });
  } catch (error) {
    log(`  跳过删除账号 ${username}: ${error.message}`);
  }
}

/** 清理仓库组织里没人引用的历史仓库，保证脚本可重复执行 */
async function sweepOrphanRepos() {
  const repos = (await giteaRequest(`/api/v1/orgs/${GITEA_ORG}/repos?limit=100`, { allow404: true })) || [];
  const referenced = new Set(
    (await prisma.project.findMany({ select: { repoName: true } })).map((item) => item.repoName).filter(Boolean),
  );
  let removed = 0;
  for (const repo of repos) {
    if (repo.name === 'repo-template' || referenced.has(repo.name)) {
      continue;
    }
    if (E2E_REPO_PATTERN.test(repo.name) || repo.name.startsWith('req-')) {
      await deleteRepo(repo.name);
      removed += 1;
    }
  }
  return removed;
}

// ============================================================
// 主流程
// ============================================================

async function cleanup() {
  const targets = await collectObsoleteUsers();
  if (targets.length === 0) {
    log('没有需要清理的历史账号');
    if (!SKIP_GITEA && GITEA_TOKEN) {
      const swept = await sweepOrphanRepos();
      log(`额外清理无人引用的历史仓库 ${swept} 个`);
    }
    return { users: 0, repos: 0 };
  }

  const repoNames = await collectGiteaTargets(targets.map((user) => user.id));
  log(`清理历史账号 ${targets.length} 个（E2E 与上一次演示数据）：${targets
    .slice(0, 3)
    .map((user) => user.name)
    .join('、')}${targets.length > 3 ? ' 等' : ''}`);

  // 按依赖顺序清理：Project.creator 与 Feedback.user 是 Restrict 外键，
  // 直接删用户会报外键冲突，因此先删“用户产生的内容”，再删账号
  const ids = targets.map((user) => user.id);
  await prisma.feedbackComment.deleteMany({ where: { userId: { in: ids } } });
  await prisma.feedback.deleteMany({ where: { userId: { in: ids } } });
  await prisma.project.deleteMany({
    where: { OR: [{ creatorId: { in: ids } }, { ownerId: { in: ids } }] },
  });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });

  if (!SKIP_GITEA) {
    for (const repoName of repoNames) {
      await deleteRepo(repoName);
    }
    for (const user of targets) {
      if (user.giteaUsername) {
        await deleteUser(user.giteaUsername);
      }
    }
    const swept = await sweepOrphanRepos();
    log(`已删除 Gitea 仓库 ${repoNames.length} 个，额外清理无人引用的仓库 ${swept} 个`);
  }

  // 管理员邮箱统一到演示域名，保证演示数据域名一致
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, orderBy: { createdAt: 'asc' } });
  if (admin && admin.email !== ADMIN_EMAIL) {
    const conflict = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL } });
    if (!conflict) {
      await prisma.user.update({ where: { id: admin.id }, data: { email: ADMIN_EMAIL } });
      log(`管理员邮箱已由 ${admin.email} 调整为 ${ADMIN_EMAIL}`);
    }
  }

  return { users: targets.length, repos: repoNames.length };
}

/** 写入人员数据，返回 key -> 用户记录 */
async function seedUsers() {
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, orderBy: { createdAt: 'asc' } });
  if (!admin) {
    throw new Error('平台没有管理员账号，请先启动后端完成管理员引导');
  }
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const map = new Map();

  for (const item of DEMO_USERS) {
    const days = 60 + Math.floor(rand() * 300);
    const user = await prisma.user.create({
      data: {
        email: item.email,
        name: item.name,
        password: passwordHash,
        role: 'EMPLOYEE',
        status: 'ACTIVE',
        department: item.department,
        skills: item.skills || [],
        avatarUrl: item.avatar,
        giteaUsername: buildGiteaUsername(item.email, item.name),
        approvedById: admin.id,
        approvedAt: toWorkday(daysAgo(days, 14, 30)),
      },
    });
    map.set(item.key, user);
  }

  for (const item of PENDING_USERS) {
    const user = await prisma.user.create({
      data: {
        email: item.email,
        name: item.name,
        password: passwordHash,
        role: 'EMPLOYEE',
        status: 'PENDING',
        department: item.department,
        avatarUrl: item.avatar,
      },
    });
    map.set(item.key, user);
  }

  log(`写入账号 ${map.size} 个（含待审核 ${PENDING_USERS.length} 个）`);
  return { map, admin };
}

/** 写入需求及其关联数据，返回可用于后续 Gitea 同步的上下文 */
async function seedProjects(userMap) {
  const projects = [];
  let feedbackCount = 0;
  let pullReqCount = 0;
  let attachmentCount = 0;

  for (const item of DEMO_PROJECTS) {
    const creator = userMap.get(item.creator);
    const owner = item.owner ? userMap.get(item.owner) : null;
    const createdAt = toWorkday(daysAgo(item.daysAgo, 9 + Math.floor(rand() * 8), Math.floor(rand() * 59)));
    const claimedAt = item.claimedDaysAgo ? daysAgo(item.claimedDaysAgo, 10, 20) : null;
    const releasedAt = item.releasedDaysAgo ? daysAgo(item.releasedDaysAgo, 16, 0) : null;
    const repoName = owner ? buildRepoName(item.title) : null;

    const project = await prisma.project.create({
      data: {
        title: item.title,
        description: item.description,
        acceptanceCriteria: item.acceptanceCriteria,
        tags: item.tags,
        avatar: item.avatar,
        status: item.status,
        expectedAt: item.expectedInDays ? new Date(Date.now() + item.expectedInDays * DAY) : null,
        creatorId: creator.id,
        ownerId: owner ? owner.id : null,
        repoOwner: repoName ? GITEA_ORG : null,
        repoName,
        repoUrl: repoName ? `${(process.env.GITEA_ROOT_URL || '').replace(/\/$/, '')}/${GITEA_ORG}/${repoName}` : null,
        claimedAt,
        releasedAt,
        createdAt,
        updatedAt: releasedAt || claimedAt || createdAt,
      },
    });
    projects.push({ item, project, repoName, members: [] });

    // 认领记录与项目成员
    if (owner) {
      await prisma.projectClaim.create({
        data: {
          projectId: project.id,
          userId: owner.id,
          remark: item.claimRemark || null,
          createdAt: claimedAt,
        },
      });
      await prisma.projectMember.create({
        data: { projectId: project.id, userId: owner.id, role: 'OWNER', createdAt: claimedAt },
      });
      for (const key of item.members || []) {
        const member = userMap.get(key);
        if (!member || member.id === owner.id) {
          continue;
        }
        await prisma.projectMember.create({
          data: {
            projectId: project.id,
            userId: member.id,
            role: 'COLLABORATOR',
            createdAt: new Date((claimedAt || createdAt).getTime() + 2 * DAY),
          },
        });
        projects[projects.length - 1].members.push(member);
      }
    }

    // 共同需求人
    for (const key of item.requesters || []) {
      const requester = userMap.get(key);
      if (!requester || requester.id === creator.id) {
        continue;
      }
      await prisma.projectRequester.create({
        data: {
          projectId: project.id,
          userId: requester.id,
          createdAt: new Date(createdAt.getTime() + (1 + Math.floor(rand() * 5)) * DAY),
        },
      });
    }

    // Pull Request
    let number = 0;
    for (const pr of item.pullReqs || []) {
      number += 1;
      const author = userMap.get(pr.author);
      const prCreatedAt = daysAgo(pr.daysAgo, 11, 0);
      await prisma.pullRequest.create({
        data: {
          projectId: project.id,
          number,
          title: pr.title,
          state: pr.merged ? 'closed' : 'open',
          merged: pr.merged,
          ciStatus: pr.ciStatus,
          hasConflict: false,
          htmlUrl: `${(process.env.GITEA_ROOT_URL || '').replace(/\/$/, '')}/${GITEA_ORG}/${repoName}/pulls/${number}`,
          authorId: author ? author.id : null,
          authorName: author ? author.name : '未知',
          headBranch: pr.headBranch,
          baseBranch: 'main',
          mergedAt: pr.merged ? new Date(prCreatedAt.getTime() + 2 * DAY) : null,
          closedAt: pr.merged ? new Date(prCreatedAt.getTime() + 2 * DAY) : null,
          createdAt: prCreatedAt,
          updatedAt: new Date(prCreatedAt.getTime() + 2 * DAY),
        },
      });
      pullReqCount += 1;
    }

    // 反馈与讨论
    for (const feedback of item.feedbacks || []) {
      const author = userMap.get(feedback.author);
      const feedbackAt = daysAgo(feedback.daysAgo, 9 + Math.floor(rand() * 9), Math.floor(rand() * 59));
      const record = await prisma.feedback.create({
        data: {
          projectId: project.id,
          userId: author.id,
          type: feedback.type,
          title: feedback.title,
          content: feedback.content,
          status: feedback.status,
          createdAt: feedbackAt,
          updatedAt: feedbackAt,
        },
      });
      feedbackCount += 1;
      for (const comment of feedback.comments || []) {
        const commenter = userMap.get(comment.author);
        await prisma.feedbackComment.create({
          data: {
            feedbackId: record.id,
            userId: commenter.id,
            content: comment.content,
            createdAt: daysAgo(comment.daysAgo, 14, 30),
          },
        });
      }
    }

    // 附件（真实落盘，保证需求页能预览、能下载）
    for (const attachment of item.attachments || []) {
      const uploader = userMap.get(attachment.uploader);
      const id = `c${crypto.randomBytes(12).toString('hex')}`;
      const extension = path.extname(attachment.name).toLowerCase();
      const date = new Date(createdAt.getTime() + DAY);
      const relativeDir = path.join(String(date.getFullYear()), String(date.getMonth() + 1).padStart(2, '0'));
      const storagePath = path.join(relativeDir, `${id}${extension}`);
      const absolutePath = path.join(UPLOAD_DIR, storagePath);
      const buffer = attachment.image === undefined
        ? Buffer.from(attachment.text, 'utf8')
        : makeScreenshotPng(attachment.image);
      await fsp.mkdir(path.dirname(absolutePath), { recursive: true });
      await fsp.writeFile(absolutePath, buffer);

      await prisma.attachment.create({
        data: {
          id,
          projectId: project.id,
          uploaderId: uploader.id,
          kind: attachment.kind,
          name: attachment.name,
          mime: attachment.kind === 'IMAGE' ? 'image/png' : 'text/plain; charset=utf-8',
          size: buffer.length,
          storagePath,
          createdAt: date,
        },
      });
      attachmentCount += 1;
    }
  }

  log(`写入需求 ${projects.length} 个、Pull Request ${pullReqCount} 条、反馈 ${feedbackCount} 条、附件 ${attachmentCount} 个`);
  return projects;
}

/** 写入站内通知（内容与前面的数据对应，不单独造事件） */
async function seedNotifications(userMap, projects) {
  const byKey = new Map(projects.map((entry) => [entry.item.key, entry.project]));
  const rows = [];

  const push = (userId, type, title, content, link, days) => {
    rows.push({ userId, type, title, content, link, read: days > 3, createdAt: daysAgo(days, 9, 30) });
  };

  const ribbon = byKey.get('shengchan-baobiao-daochu');
  const abnormal = byKey.get('zhiliang-yichang');
  const dispatch = byKey.get('gongdan-paigong');
  const kit = byKey.get('wuliao-qitao');
  const warehouse = byKey.get('cangku-kuwei');
  const travel = byKey.get('chailv-baoxiao');

  push(userMap.get('xuqian').id, 'PR_UPDATED', '需求「生产报表自动导出与定时推送」有新提交', '吴迪 提交了 Pull Request：fix: 修正跨零点班次的日期归属', `/projects/${ribbon.id}`, 3);
  push(userMap.get('wudi').id, 'FEEDBACK_CREATED', '收到新的反馈：导出的报表缺少合计行', '徐倩 在「生产报表自动导出与定时推送」中提交了缺陷反馈', `/projects/${ribbon.id}`, 4);
  push(userMap.get('zhangwei').id, 'CI_FINISHED', '流水线执行失败', '「质量异常闭环管理」的流水线未通过，请查看日志', `/projects/${abnormal.id}`, 2);
  push(userMap.get('zhengkai').id, 'PROJECT_MEMBER_ADDED', '你被加入项目：质量异常闭环管理', '王强 把你添加为协作者', `/projects/${abnormal.id}`, 15);
  push(userMap.get('linfang').id, 'FEEDBACK_CREATED', '收到新的反馈：工人端看不到刚派的工单', '张伟 在「工单派工与进度看板」中提交了缺陷反馈', `/projects/${dispatch.id}`, 3);
  push(userMap.get('chenxiaodong').id, 'PR_UPDATED', '需求「物料齐套率分析与预警」有新提交', '黄磊 提交了 Pull Request：feat: 缺料预警推送', `/projects/${kit.id}`, 5);
  push(userMap.get('zhouhang').id, 'PROJECT_CLAIMED', '你认领了需求：仓库库位可视化查询', '请在需求详情页创建或进入仓库开始开发', `/projects/${warehouse.id}`, 18);
  push(userMap.get('sunyiming').id, 'PROJECT_MEMBER_ADDED', '你被加入项目：差旅报销单据智能校验', '李静 把你添加为协作者', `/projects/${travel.id}`, 26);
  push(userMap.get('lijing').id, 'PROJECT_REQUESTER_ADDED', '有同事关注了你的需求：差旅报销单据智能校验', '高媛 加入了共同需求人', `/projects/${travel.id}`, 20);
  push(userMap.get('matao').id, 'FEEDBACK_CREATED', '收到新的反馈：上传体检报告时提示格式不支持', '谢婷 在「员工入职材料线上收集」中提交了缺陷反馈', `/projects/${byKey.get('ruzhi-cailiao').id}`, 12);

  await prisma.notification.createMany({ data: rows });
  log(`写入站内通知 ${rows.length} 条`);
}

/** 同步 Gitea：账号、仓库、协作者、Webhook、流水线回调、Issue */
async function seedGitea(userMap, projects) {
  if (SKIP_GITEA) {
    log('已跳过 Gitea 同步（--skip-gitea）');
    return;
  }
  if (!GITEA_TOKEN) {
    log('未配置 GITEA_API_TOKEN，跳过 Gitea 同步');
    return;
  }

  let createdUsers = 0;
  for (const item of DEMO_USERS) {
    const user = userMap.get(item.key);
    const created = await ensureGiteaUser({
      username: user.giteaUsername,
      email: user.email,
      name: user.name,
    });
    if (created) {
      createdUsers += 1;
    }
  }
  log(`Gitea 账号：新建 ${createdUsers} 个，其余已存在`);

  let createdRepos = 0;
  let issueCount = 0;
  for (const entry of projects) {
    const { item, project, repoName } = entry;
    if (!repoName) {
      continue;
    }
    const description = `[需求协作平台] ${item.title}`;
    if (await ensureRepoFromTemplate(repoName, description)) {
      createdRepos += 1;
    }
    await ensureWebhook(repoName);
    await configureCiReporting(repoName);

    // 仓库权限：负责人 + 协作者
    const owner = project.ownerId ? userMap.get(item.owner) : null;
    if (owner) {
      await addCollaborator(repoName, owner.giteaUsername);
    }
    for (const key of item.members || []) {
      const member = userMap.get(key);
      if (member) {
        await addCollaborator(repoName, member.giteaUsername);
      }
    }

    // 反馈对应的 Issue：正文里带上提交人，和平台内展示一致
    const feedbacks = await prisma.feedback.findMany({
      where: { projectId: project.id },
      include: { user: { select: { name: true, email: true } } },
      orderBy: { createdAt: 'asc' },
    });
    for (const feedback of feedbacks) {
      const label = { BUG: 'bug', IMPROVEMENT: 'enhancement', QUESTION: 'question' }[feedback.type];
      const issue = await createIssue(repoName, {
        title: feedback.title,
        body: `**提交人**：${feedback.user.name}（${feedback.user.email}）\n\n${feedback.content}\n\n---\n由需求协作平台同步。`,
        labels: [label],
      });
      issueCount += 1;
      await prisma.feedback.update({
        where: { id: feedback.id },
        data: { issueNumber: issue.number, issueUrl: issue.html_url },
      });

      const comments = await prisma.feedbackComment.findMany({
        where: { feedbackId: feedback.id },
        include: { user: { select: { name: true } } },
        orderBy: { createdAt: 'asc' },
      });
      for (const comment of comments) {
        await createIssueComment(repoName, issue.number, `**${comment.user.name}**：\n\n${comment.content}`);
      }
    }
  }
  log(`Gitea 仓库：新建 ${createdRepos} 个；同步 Issue ${issueCount} 个`);
}

async function main() {
  log(`开始写入演示数据（域名 @${DEMO_DOMAIN}，密码 ${DEMO_PASSWORD}）`);
  if (!fs.existsSync(UPLOAD_DIR)) {
    await fsp.mkdir(UPLOAD_DIR, { recursive: true });
  }

  const cleaned = await cleanup();
  const { map } = await seedUsers();
  const projects = await seedProjects(map);
  await seedNotifications(map, projects);
  await seedGitea(map, projects);

  const stats = await prisma.project.groupBy({ by: ['status'], _count: { _all: true } });
  const total = await prisma.user.count({ where: { status: 'ACTIVE' } });

  console.log('');
  log('演示数据写入完成');
  log(`账号：在职 ${total} 人（任何账号都能提需求、也能认领需求，另有 ${PENDING_USERS.length} 人待审核）`);
  log(
    `需求：${DEMO_PROJECTS.length} 个（${stats
      .map((row) => `${row.status} ${row._count._all}`)
      .join('，')}）`,
  );
  log(`清理：移除历史账号 ${cleaned.users} 个、仓库 ${cleaned.repos} 个`);
  log(`演示登录：${ADMIN_EMAIL} / ${process.env.ADMIN_PASSWORD || 'Admin@123456'}（管理员）`);
  log(`演示登录：zhang.wei@${DEMO_DOMAIN} / ${DEMO_PASSWORD}（同事，多为提出需求）`);
  log(`演示登录：zhou.hang@${DEMO_DOMAIN} / ${DEMO_PASSWORD}（同事，多为认领实现）`);
}

main()
  .catch((error) => {
    console.error('[seed] 执行失败：', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
