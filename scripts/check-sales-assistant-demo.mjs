import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const sourcePath = resolve(
  repoRoot,
  'src/components/home/salesAssistantDemo.ts'
);
const homeSourcePath = resolve(repoRoot, 'src/app/pages/Home.tsx');

const source = readFileSync(sourcePath, 'utf8');
const homeSource = readFileSync(homeSourcePath, 'utf8');

const requiredScenarioIds = [
  'terms',
  'compare',
  'recommend',
  'underwriting',
  'ops',
  'customerPolicy',
];

for (const id of requiredScenarioIds) {
  if (!source.includes(`id: '${id}'`)) {
    throw new Error(`Missing sales assistant scenario: ${id}`);
  }
}

const requiredPhrases = [
  '产品条款咨询',
  '产品信息比对',
  '产品推荐',
  '核保问题咨询',
  '运维操作问题咨询',
  '客户、保单信息咨询',
  'salesKnowledgeBaseMcpTool',
  'SalesAgentPlan',
  'mcp__sales_knowledge_base__query_product_terms',
  '销售知识库 MCP',
  'agentTrace',
  'insurance-customer-policy-consulting',
  'customer-policy-query-sop',
  'buildCustomerUrl',
  'buildPolicyUrl',
  'https://crm.example.com/customers/',
  'https://policy.example.com/policies/',
  'getScenarioCount',
];

for (const phrase of requiredPhrases) {
  if (!source.includes(phrase)) {
    throw new Error(`Missing required sales assistant phrase: ${phrase}`);
  }
}

const homeRequiredPhrases = [
  'SalesDemoPlanCard',
  'SalesDemoExecutionSteps',
  '执行计划',
  '隐藏步骤',
  'getTraceToolLabel',
  '模拟客户/保单查询',
  'getSalesDemoStepIndexForPrompt',
  'getMockDetailFromHref',
  'CustomerDetailContent',
  'PolicyDetailContent',
];

for (const phrase of homeRequiredPhrases) {
  if (!homeSource.includes(phrase)) {
    throw new Error(`Missing sales assistant UI phrase: ${phrase}`);
  }
}

const promptMarkers = [
  '等待期和免赔额',
  '普通门诊',
  '安康优享百万医疗和康惠保长期医疗',
  '银保渠道代理人',
  '甲状腺结节 3 类',
  '建议书生成失败',
  '客户李明',
  '客户号 C10086',
  '保单号 P20260521001',
];

for (const marker of promptMarkers) {
  if (!homeSource.includes(`prompt.includes('${marker}')`)) {
    throw new Error(`Missing specific thinking branch for prompt: ${marker}`);
  }
}

const thinkingLines = [
  ...homeSource.matchAll(/return \[\n([\s\S]*?)\n\s*\]\.join\('\\n'\);/g),
].map((match) => (match[1].match(/^\s*'/gm) || []).length);

const uniqueLineCounts = new Set(thinkingLines);
if (uniqueLineCounts.size < 3) {
  throw new Error(
    `Thinking branches look too uniform: ${[...uniqueLineCounts].join(', ')}`
  );
}

console.log('sales assistant demo contract passed');
