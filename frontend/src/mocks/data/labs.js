// Shape: LabTemplate (section 5). Templates are never deleted; admins switch `enabled` off.
export const labs = [
  {
    id: 'lab_python', name: 'Python Development', type: 'python',
    description: 'Python with data tools and Jupyter',
    tools: ['Python', 'pip', 'NumPy', 'Pandas', 'Matplotlib', 'Jupyter'],
    dockerImage: 'cloudlab/python:1.0', limits: { cpu: 2, memoryGb: 2, storageGb: 5 },
    enabled: true, comingSoon: false,
  },
  {
    id: 'lab_java', name: 'Java Development', type: 'java',
    description: 'JDK 21 with Maven for OOP and DSA practicals',
    tools: ['JDK 21', 'Maven', 'Git'],
    dockerImage: 'cloudlab/java:1.0', limits: { cpu: 2, memoryGb: 2, storageGb: 5 },
    enabled: true, comingSoon: false,
  },
  {
    id: 'lab_web', name: 'Web Development', type: 'web',
    description: 'Node.js, npm and Git for full-stack projects',
    tools: ['Node.js', 'npm', 'Git'],
    dockerImage: 'cloudlab/web:1.0', limits: { cpu: 2, memoryGb: 2, storageGb: 5 },
    enabled: true, comingSoon: false,
  },
  {
    id: 'lab_datascience', name: 'Data Science', type: 'datascience',
    description: 'Python and R for data analysis, statistics and machine learning, with JupyterLab',
    tools: ['Python 3', 'pandas', 'scikit-learn', 'statsmodels', 'JupyterLab', 'R'],
    dockerImage: 'cloudlab/datascience:1.0', limits: { cpu: 2, memoryGb: 2, storageGb: 5 },
    enabled: true, comingSoon: false,
  },
  {
    id: 'lab_cloud', name: 'Cloud Computing', type: 'cloud',
    description: 'gcloud CLI, Docker CLI and Terraform',
    tools: ['gcloud CLI', 'Docker CLI', 'Terraform'],
    dockerImage: 'cloudlab/cloud:0.1', limits: { cpu: 2, memoryGb: 2, storageGb: 5 },
    enabled: true, comingSoon: true,
  },
];
