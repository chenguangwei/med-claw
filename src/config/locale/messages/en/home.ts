export default {
  inputPlaceholder: 'Type anything...',
  reply: 'Reply...',
  welcomeTitle: 'What can I do for you?',
  welcomeSubtitle: 'I can help you with coding, writing, analysis, and more.',
  addFilesOrPhotos: 'Add files or photos',
  dropFilesHere: 'Drop files here',
  modeAuto: 'Auto',
  modeChat: 'Chat',
  modeTask: 'Task',
  modeAutoDesc: 'Auto-detect intent',
  modeChatDesc: 'Quick conversation',
  modeTaskDesc: 'Full agent capabilities',
  modeLabel: 'Mode',
  examplePrompts: {
    categories: {
      organizeFiles: {
        label: 'Organize Docs',
        placeholder:
          'Describe how you want to organize internal business documents',
        prompts: [
          "Organize the 'Sales Contracts' folder by grouping contracts, quotes, and addendums by customer, signing month, and contract status. Generate a checklist of missing materials.",
          "Scan the shared 'Admin Policies' folder, identify duplicate, outdated, and poorly named policy documents, and organize the findings into an Excel review log.",
          "Read the 'Project Meeting Notes' folder, reorganize files by project name and meeting date, and generate an index with topic, owner, and action items.",
        ],
      },
      generateDocs: {
        label: 'Generate Docs',
        placeholder: 'Describe the document you want to generate',
        prompts: [
          "Use 'Monthly Operations Data.xlsx' and department weekly reports to generate a management-facing operations review deck with key metrics, risks, and next-month priorities.",
          "Summarize the notes in the 'Customer Visit Records' folder into a Word follow-up report by customer, including needs, progress, next actions, and owners.",
          "Read the 'New Hire Onboarding Materials' folder and draft a standardized onboarding handbook covering process steps, system accounts, admin items, and FAQs.",
        ],
      },
      automateTasks: {
        label: 'Automate Tasks',
        placeholder: 'Describe the task you want to automate',
        prompts: [
          'Every Friday afternoon, summarize weekly reports submitted by each department, extract progress, risks, and next-week plans, and generate an executive weekly summary.',
          "Every morning, check the 'Pending Contract Approvals' folder for new files, extract contract number, customer name, amount, and due date, and update the approval tracker.",
          'At the beginning of each month, read the attendance sheet and reimbursement details, flag abnormal records, and generate a review list for HR and Finance.',
        ],
      },
    },
  },
};
