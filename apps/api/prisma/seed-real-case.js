#!/usr/bin/env node
/**
 * aiManager 真实案例种子
 * 作用：向当前开发数据库幂等写入平台自身这条需求，不清理任何已有演示数据。
 * 用法：npm run seed:real-case
 */
'use strict';

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const CASE_TITLE = '内部需求协作平台（aiManager 真实案例）';

/** 写入当前工程作为平台真实案例 */
async function seedRealCase() {
  const admin = await prisma.user.findFirst({
    where: { role: 'ADMIN', status: 'ACTIVE' },
    orderBy: { createdAt: 'asc' },
  });
  if (!admin) {
    throw new Error('当前数据库没有可用管理员，请先启动平台完成管理员初始化');
  }

  const existing = await prisma.project.findFirst({ where: { title: CASE_TITLE } });
  if (existing) {
    const updateCount = await prisma.projectUpdate.count({ where: { projectId: existing.id } });
    if (updateCount === 0) {
      await prisma.projectUpdate.create({
        data: {
          projectId: existing.id,
          authorId: admin.id,
          kind: 'COMMUNICATION',
          content: '这是平台自身的真实案例，后续所有体验优化都会优先在这条需求上验证。',
        },
      });
    }
    console.log(`[real-case] 案例已存在，跳过：${existing.id}`);
    return existing;
  }

  const project = await prisma.$transaction(async (tx) => {
    const created = await tx.project.create({
      data: {
      title: CASE_TITLE,
      description: `## 为什么做这个平台

公司内部有很多真实需求，但过去通常散落在聊天、邮件和个人表格里：提出需求的人不知道进展，愿意帮忙的人也找不到适合自己的事项。

## 这个案例覆盖的完整流程

1. 在需求池发布一条需求，支持图片插入和可选附件。
2. 同事可以点「我也想用」表达共同需要，也可以点「我来做」认领开发。
3. 认领后自动创建 Gitea 代码库，开发者通过 Pull Request、自动检查和反馈协作。
4. 需求详情保留原始描述，并通过沟通记录和追加需求时间线持续补充。
5. 成果中心统一展示 README、使用教程、成果地址和可下载文件。
6. 需求方按实际工作方式试用，反馈问题，直到确认可以使用。

## 适合谁使用

- 任何有重复、低效或想改进的内部工作
- 愿意帮同事解决问题的业务专家和开发同事
- 需要看清需求、进展、成果和反馈闭环的管理者`,
      acceptanceCriteria: '能从发布需求开始走通认领、协作开发、成果展示、沟通追加与反馈验收闭环。',
      tags: ['真实案例', '内部工具', '需求协作', '流程改进'],
      requiredSkills: ['产品协作', '前端', '后端', '用户体验'],
      avatar: 'task-08',
      status: 'OPEN',
      creatorId: admin.id,
      },
    });
    await tx.projectUpdate.createMany({
      data: [
        {
          projectId: created.id,
          authorId: admin.id,
          kind: 'COMMUNICATION',
          content: '这是平台自身的真实案例，后续所有体验优化都会优先在这条需求上验证。',
        },
        {
          projectId: created.id,
          authorId: admin.id,
          kind: 'ADDITIONAL_REQUIREMENT',
          content: '后续补充：继续观察新手第一次发布需求、认领开发和查看成果时是否需要更多指引。',
        },
      ],
    });
    return created;
  });

  console.log(`[real-case] 已写入案例：${project.id}（需求方：${admin.name}）`);
  return project;
}

seedRealCase()
  .catch((error) => {
    console.error('[real-case] 执行失败：', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
