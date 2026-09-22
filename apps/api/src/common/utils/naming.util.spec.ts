/**
 * 命名工具单测
 * 作用：先锁定 Gitea 仓库名称的可读性与合法性边界，避免页面输入导致建仓失败
 */
import { normalizeRepoName } from './naming.util';

describe('normalizeRepoName', () => {
  it('去除首尾空格并保留合法的英文仓库名', () => {
    expect(normalizeRepoName('  monthly-report_2026  ')).toBe('monthly-report_2026');
  });

  it('空输入返回 undefined，交给默认命名规则处理', () => {
    expect(normalizeRepoName('   ')).toBeUndefined();
    expect(normalizeRepoName(undefined)).toBeUndefined();
  });

  it('拒绝中文、空格、路径分隔符和 git 保留后缀', () => {
    expect(() => normalizeRepoName('生产报表')).toThrow('仓库名只能使用字母');
    expect(() => normalizeRepoName('monthly report')).toThrow('仓库名只能使用字母');
    expect(() => normalizeRepoName('../monthly-report')).toThrow('仓库名只能使用字母');
    expect(() => normalizeRepoName('monthly-report.git')).toThrow('仓库名不能以 .git 结尾');
  });
});
