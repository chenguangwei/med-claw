export type SalesDemoTurn =
  | {
      role: 'user';
      prompt: string;
    }
  | {
      role: 'assistant';
      agentTrace?: SalesAgentTrace;
      plan?: SalesAgentPlan;
      thinking: string[];
      chunks: string[];
    };

export interface SalesAgentTraceItem {
  name: string;
  input: string;
  output: string;
}

export interface SalesAgentKnowledgeHit {
  source: string;
  summary: string;
}

export interface SalesAgentTrace {
  intent: string;
  skills: SalesAgentTraceItem[];
  tools: SalesAgentTraceItem[];
  knowledgeHits: SalesAgentKnowledgeHit[];
  decisions: string[];
}

export interface SalesAgentPlan {
  goal: string;
  steps: string[];
  note: string;
}

export interface SalesDemoScenario {
  id:
    | 'terms'
    | 'compare'
    | 'recommend'
    | 'underwriting'
    | 'ops'
    | 'customerPolicy';
  title: string;
  intent: string;
  turns: SalesDemoTurn[];
}

const salesKnowledgeBaseMcpTool =
  'mcp__sales_knowledge_base__query_product_terms';

export interface SalesFaq {
  question: string;
  answer: string;
}

export const salesFaqs: SalesFaq[] = [
  {
    question: '热销医疗险的等待期是多久？',
    answer: '一般疾病等待期 30 天，意外医疗无等待期，续保不重新计算等待期。',
  },
  {
    question: '同一客户能同时配置重疾险和百万医疗吗？',
    answer:
      '可以。重疾险解决一次性给付，医疗险覆盖住院报销，建议搭配说明责任边界。',
  },
  {
    question: '代理人渠道如何匹配可售产品？',
    answer: '先识别渠道编码，再过滤该渠道已上架、可售、未停售的产品清单。',
  },
  {
    question: '客户问保单状态时需要什么信息？',
    answer: '先提示输入客户号或保单号，再返回固定话术和可点击详情链接。',
  },
];

export const salesDemoScenarios: SalesDemoScenario[] = [
  {
    id: 'terms',
    title: '场景 1：产品条款咨询',
    intent: '识别为产品条款咨询，定位责任、等待期、免赔额和除外责任。',
    turns: [
      {
        role: 'user',
        prompt: '产品条款咨询：安康优享百万医疗的等待期和免赔额怎么解释？',
      },
      {
        role: 'assistant',
        plan: {
          goal: '查询并解释安康优享百万医疗产品的等待期和免赔额条款',
          steps: [
            '使用销售知识库 MCP 查询产品详细信息',
            '核对产品条款中的等待期和免赔额字段',
            '整理等待期和免赔额的解释说明',
          ],
          note: '将基于销售知识库 MCP 的真实信息进行解答',
        },
        agentTrace: {
          intent: '产品条款咨询',
          skills: [
            {
              name: 'insurance-product-terms-consulting',
              input: '产品条款咨询：安康优享百万医疗的等待期和免赔额怎么解释？',
              output:
                '命中产品条款咨询流程，需要调用销售知识库 MCP 查询产品责任字段。',
            },
          ],
          tools: [
            {
              name: salesKnowledgeBaseMcpTool,
              input:
                'productName=安康优享百万医疗 2026 版; fields=等待期,免赔额,续保规则,除外责任',
              output:
                '销售知识库 MCP 返回：疾病住院等待期 30 天；意外医疗无等待期；一般医疗年度免赔额 1 万元；重大疾病医疗 0 免赔。',
            },
          ],
          knowledgeHits: [
            {
              source:
                '销售知识库 MCP / product_terms/ankang-youxiang-million-medical-2026',
              summary:
                '安康优享百万医疗 2026 版条款：疾病住院医疗等待期 30 天，意外医疗不设等待期；一般医疗年度免赔额 1 万元，重大疾病医疗 0 免赔。',
            },
          ],
          decisions: [
            '识别意图：产品条款咨询。',
            '通过销售知识库 MCP 检索安康优享百万医疗 2026 版条款。',
            '抽取等待期、年度免赔额、续保规则和除外责任字段。',
            '将条款语言整理成销售人员可直接解释的口径。',
          ],
        },
        thinking: [
          '识别意图：产品条款咨询。',
          '检索产品：安康优享百万医疗 2026 版。',
          '抽取条款字段：等待期、年度免赔额、续保规则、除外责任。',
        ],
        chunks: [
          '安康优享百万医疗可以这样向客户说明：\n\n',
          '- 等待期：疾病住院医疗等待期 30 天，意外医疗不设等待期。\n',
          '- 免赔额：一般医疗年度免赔额 1 万元，重大疾病医疗 0 免赔。\n',
          '- 续保：续保不重新计算等待期，但需以续保时产品规则为准。\n',
          '- 话术建议：如果客户关注“小病报销”，要明确本产品更适合覆盖大额住院风险。\n',
        ],
      },
      {
        role: 'user',
        prompt: '那门诊责任是否包含普通门诊？',
      },
      {
        role: 'assistant',
        thinking: [
          '继续沿用上一轮产品上下文。',
          '区分普通门诊、特殊门诊、门诊手术和住院前后门急诊。',
        ],
        chunks: [
          '不包含普通门诊。当前条款覆盖的是特殊门诊、门诊手术，以及住院前 7 天后 30 天门急诊。',
          '建议补充一句：日常感冒发烧门诊不在本产品核心责任内，客户如有需求可搭配小额门诊险。',
        ],
      },
    ],
  },
  {
    id: 'compare',
    title: '场景 2：产品信息比对',
    intent: '识别为产品比对，输出差异点和适用客群。',
    turns: [
      {
        role: 'user',
        prompt: '产品信息比对：安康优享百万医疗和康惠保长期医疗有什么差异？',
      },
      {
        role: 'assistant',
        thinking: [
          '识别意图：产品信息比对。',
          '抽取两款产品的保障期限、免赔额、增值服务、渠道限制。',
          '按销售端最常用维度合并成对比结论。',
        ],
        chunks: [
          '两款产品核心差异如下：\n\n',
          '| 维度 | 安康优享百万医疗 | 康惠保长期医疗 |\n| --- | --- | --- |\n',
          '| 保障期限 | 1 年期，可续保 | 6 年保证续保 |\n',
          '| 一般医疗免赔额 | 1 万元 | 1 万元，可家庭共享 |\n',
          '| 重疾医疗 | 0 免赔 | 0 免赔，含质子重离子 |\n',
          '| 适合客户 | 预算敏感、首次配置医疗险 | 看重长期稳定续保的家庭客户 |\n\n',
          '销售建议：如果客户担心停售或续保变化，优先讲康惠保长期医疗；如果客户只想低成本补齐大额医疗缺口，可讲安康优享。',
        ],
      },
    ],
  },
  {
    id: 'recommend',
    title: '场景 3：产品推荐',
    intent: '识别代理人渠道，推荐该渠道对应产品。',
    turns: [
      {
        role: 'user',
        prompt:
          '产品推荐：我是银保渠道代理人，客户 35 岁，有家庭责任，推荐什么产品？',
      },
      {
        role: 'assistant',
        thinking: [
          '识别意图：产品推荐。',
          '识别渠道：银保渠道。',
          '过滤规则：仅推荐银保渠道上架且可销售产品。',
          '结合客户画像：35 岁、家庭责任、保障缺口。',
        ],
        chunks: [
          '根据银保渠道可售清单，建议优先推荐：\n\n',
          '1. **稳享人生终身寿险（银保版）**：适合家庭资产传承和长期储蓄需求。\n',
          '2. **康惠保长期医疗（银保渠道）**：补齐大额医疗风险，适合家庭经济支柱。\n',
          '3. **守护星重大疾病保险（银保专属）**：覆盖重疾一次性给付，便于客户理解保障杠杆。\n\n',
          '推荐顺序：先讲医疗险解决大额住院风险，再用重疾险解释收入损失，最后根据客户预算讨论终身寿。',
        ],
      },
    ],
  },
  {
    id: 'underwriting',
    title: '场景 5：核保问题咨询',
    intent: '识别为核保咨询，给出资料清单和初步处理建议。',
    turns: [
      {
        role: 'user',
        prompt: '核保问题咨询：客户有甲状腺结节 3 类，投保重疾险需要补充什么？',
      },
      {
        role: 'assistant',
        thinking: [
          '识别意图：核保问题咨询。',
          '匹配疾病标签：甲状腺结节 TI-RADS 3 类。',
          '输出销售端可执行的补充资料清单。',
        ],
        chunks: [
          '可以先提示客户补充以下资料：\n\n',
          '- 近 6 个月甲状腺超声报告，需包含 TI-RADS 分级、大小、边界和血流情况。\n',
          '- 如做过穿刺或手术，补充病理报告和出院小结。\n',
          '- 近期甲功五项结果，如无异常可一并说明。\n\n',
          '初步话术：3 类结节通常可进入人工核保，结论可能是标准体、除外、加费或延期，以核保最终通知为准。',
        ],
      },
    ],
  },
  {
    id: 'ops',
    title: '场景 6：运维操作问题咨询',
    intent: '识别为运维/系统操作咨询，给出路径和排查步骤。',
    turns: [
      {
        role: 'user',
        prompt: '运维操作问题咨询：代理人说建议书生成失败，应该怎么处理？',
      },
      {
        role: 'assistant',
        thinking: [
          '识别意图：运维操作问题咨询。',
          '定位操作对象：建议书生成。',
          '按销售端一线排障顺序输出。',
        ],
        chunks: [
          '建议按以下顺序处理：\n\n',
          '1. 让代理人刷新销售工作台，确认网络和登录态是否正常。\n',
          '2. 检查产品是否已停售、渠道是否有销售权限、客户年龄是否超出投保范围。\n',
          '3. 如页面提示“费率计算失败”，复制错误码提交工单。\n',
          '4. 工单分类选择：销售系统 > 建议书 > 生成失败，并附代理人工号、产品名称、客户年龄和错误截图。\n\n',
          '标准回复：已按建议书生成失败流程受理，请提供错误截图或错误码，便于运维快速定位。',
        ],
      },
    ],
  },
  {
    id: 'customerPolicy',
    title: '场景 7：客户、保单信息咨询',
    intent: '识别为客户/保单信息查询，先索要客户号或保单号，再拼接链接。',
    turns: [
      {
        role: 'user',
        prompt: '客户、保单信息咨询：帮我查一下客户李明的保单状态。',
      },
      {
        role: 'assistant',
        agentTrace: {
          intent: '客户、保单信息咨询',
          skills: [
            {
              name: 'insurance-customer-policy-consulting',
              input: '客户、保单信息咨询：帮我查一下客户李明的保单状态。',
              output: '命中客户/保单信息查询流程，需要先校验唯一查询入参。',
            },
          ],
          tools: [
            {
              name: 'extractCustomerPolicyIdentifier',
              input: '帮我查一下客户李明的保单状态。',
              output: '未提取到客户号或保单号。',
            },
          ],
          knowledgeHits: [
            {
              source: 'customer-policy-query-sop',
              summary:
                '客户/保单查询必须使用客户号或保单号作为最小入参；姓名不能唯一定位客户。',
            },
          ],
          decisions: [
            '识别意图：客户、保单信息咨询。',
            '检查入参：只有客户姓名，没有客户号或保单号。',
            '安全约束：姓名可能重名，且涉及个人与保单敏感信息，不能直接返回结果。',
            '下一步：先提示用户补充客户号或保单号。',
          ],
        },
        thinking: [
          '识别意图：客户、保单信息咨询。',
          '发现缺少必要入参：客户号或保单号。',
          '按要求先提示用户补充编号。',
        ],
        chunks: [
          '请提供客户号或保单号后继续查询。例如：客户号 C10086，或保单号 P20260521001。',
        ],
      },
      {
        role: 'user',
        prompt: '客户号 C10086',
      },
      {
        role: 'assistant',
        agentTrace: {
          intent: '客户、保单信息咨询',
          skills: [
            {
              name: 'insurance-customer-policy-consulting',
              input: '客户号 C10086',
              output: '识别为客户维度查询，进入客户详情链接生成流程。',
            },
          ],
          tools: [
            {
              name: 'extractCustomerPolicyIdentifier',
              input: '客户号 C10086',
              output: 'customerNo=C10086',
            },
            {
              name: 'buildCustomerUrl',
              input: 'customerNo=C10086',
              output: buildCustomerUrl('C10086'),
            },
          ],
          knowledgeHits: [
            {
              source: 'customer-policy-query-sop',
              summary:
                '客户号查询返回客户详情入口，详情页承载证件、联系方式、名下保单和服务记录。',
            },
          ],
          decisions: [
            '识别意图：客户、保单信息咨询。',
            '提取客户号：C10086。',
            '分流判断：客户号走客户详情入口，不走保单详情入口。',
            '拼接客户详情链接，并返回指定客户查询话术。',
          ],
        },
        thinking: ['提取客户号：C10086。', '拼接客户详情链接并返回指定话术。'],
        chunks: [
          '已识别客户号 **C10086**。\n\n',
          '指定话术：客户信息已定位，请点击下方链接进入客户详情页查看证件、联系方式、名下保单和服务记录。\n\n',
          `[查看客户详情](${buildCustomerUrl('C10086')})`,
        ],
      },
      {
        role: 'user',
        prompt: '再查保单号 P20260521001',
      },
      {
        role: 'assistant',
        agentTrace: {
          intent: '客户、保单信息咨询',
          skills: [
            {
              name: 'insurance-customer-policy-consulting',
              input: '再查保单号 P20260521001',
              output: '识别为保单维度查询，进入保单详情链接生成流程。',
            },
          ],
          tools: [
            {
              name: 'extractCustomerPolicyIdentifier',
              input: '再查保单号 P20260521001',
              output: 'policyNo=P20260521001',
            },
            {
              name: 'buildPolicyUrl',
              input: 'policyNo=P20260521001',
              output: buildPolicyUrl('P20260521001'),
            },
          ],
          knowledgeHits: [
            {
              source: 'customer-policy-query-sop',
              summary:
                '保单号查询返回保单详情入口，详情页承载状态、缴费计划、责任明细和批改记录。',
            },
          ],
          decisions: [
            '识别意图：客户、保单信息咨询。',
            '提取保单号：P20260521001。',
            '分流判断：保单号走保单详情入口，不能沿用上一轮客户号链接。',
            '拼接保单详情链接，并返回指定保单查询话术。',
          ],
        },
        thinking: [
          '提取保单号：P20260521001。',
          '拼接保单详情链接并返回指定话术。',
        ],
        chunks: [
          '已识别保单号 **P20260521001**。\n\n',
          '指定话术：保单信息已定位，请点击下方链接进入保单详情页查看状态、缴费计划、责任明细和批改记录。\n\n',
          `[查看保单详情](${buildPolicyUrl('P20260521001')})`,
        ],
      },
    ],
  },
];

export function buildCustomerUrl(customerNo: string) {
  return `https://crm.example.com/customers/${encodeURIComponent(customerNo)}`;
}

export function buildPolicyUrl(policyNo: string) {
  return `https://policy.example.com/policies/${encodeURIComponent(policyNo)}`;
}

export function getScenarioCount() {
  return salesDemoScenarios.length;
}
