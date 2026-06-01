export default {
  inputPlaceholder: '输入任何内容...',
  reply: '回复...',
  welcomeTitle: '有什么可以帮到你？',
  welcomeSubtitle: '我可以帮你完成编程、写作、分析等各种任务。',
  addFilesOrPhotos: '添加文件或图片',
  dropFilesHere: '拖放文件到此处',
  modeAuto: '自动',
  modeChat: '对话',
  modeTask: '任务',
  modeAutoDesc: '自动识别意图',
  modeChatDesc: '快速对话',
  modeTaskDesc: '完整 Agent 能力',
  modeLabel: '模式',
  examplePrompts: {
    categories: {
      organizeFiles: {
        label: '整理文档',
        placeholder: '描述你想要如何整理企业内部文档',
        prompts: [
          '整理「销售合同」文件夹中的合同、报价单和补充协议，按客户名称、签约月份和合同状态归档，并生成一份待补充材料清单。',
          '扫描「行政制度」共享文件夹，找出重复、过期和命名不规范的制度文档，整理成可审核的 Excel 台账。',
          '读取「项目会议纪要」文件夹，按项目名称和会议日期重新分类归档，并生成一份包含会议主题、负责人和待办事项的索引表。',
        ],
      },
      generateDocs: {
        label: '生成文档',
        placeholder: '描述你想要生成的文档',
        prompts: [
          '根据「月度经营数据.xlsx」和各部门周报，生成一份面向管理层的经营分析 PPT，包含关键指标、风险提示和下月重点计划。',
          '汇总「客户拜访记录」文件夹中的纪要，按客户生成 Word 跟进报告，包含客户诉求、当前进展、下一步动作和责任人。',
          '读取「新员工入职材料」文件夹，生成一份标准化入职手册草稿，覆盖流程、系统账号、行政事项和常见问题。',
        ],
      },
      automateTasks: {
        label: '自动化任务',
        placeholder: '描述你想要自动化的任务',
        prompts: [
          '每周五下午自动汇总各部门提交的周报，提取本周进展、风险问题和下周计划，生成管理层周报摘要。',
          '每天上午检查「待审批合同」文件夹的新文件，提取合同编号、客户名称、金额和截止日期，更新到合同审批台账。',
          '每月初读取考勤表和报销明细，自动标记异常记录，生成需要 HR 和财务复核的清单。',
        ],
      },
    },
  },
};
