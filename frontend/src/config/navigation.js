import {
  Activity, BarChart3, BookOpen, ClipboardList, Cpu, Database, FolderOpen, Gauge, LayoutDashboard,
  Layers, PieChart, ServerCog, Settings, ShieldCheck, TerminalSquare, Timer, Users,
} from 'lucide-react';

// Sidebar links per role. Every link has a real page.
export const NAV = {
  student: [
    { to: '/student', label: 'Overview', icon: LayoutDashboard, end: true },
    { to: '/student/catalog', label: 'Lab Catalog', icon: BookOpen },
    { to: '/student/labs', label: 'My Labs', icon: TerminalSquare },
    { to: '/student/projects', label: 'Projects & Files', icon: FolderOpen },
    { to: '/student/datasets', label: 'Datasets', icon: Database },
    { to: '/student/usage', label: 'Usage', icon: PieChart },
  ],
  faculty: [
    { to: '/faculty', label: 'Overview', icon: LayoutDashboard, end: true },
    { to: '/faculty/students', label: 'Students', icon: Users },
    { to: '/faculty/templates', label: 'Lab Templates', icon: Layers },
    { to: '/faculty/activities', label: 'Assign Activity', icon: ClipboardList },
    { to: '/faculty/datasets', label: 'Datasets', icon: Database },
    { to: '/faculty/usage', label: 'Usage Monitor', icon: Activity },
  ],
  admin: [
    { to: '/admin', label: 'Overview', icon: Gauge, end: true },
    { to: '/admin/infrastructure', label: 'Infrastructure', icon: ServerCog },
    { to: '/admin/environments', label: 'Active Environments', icon: Cpu },
    { to: '/admin/users', label: 'User Management', icon: Users },
    { to: '/admin/templates', label: 'Lab Templates', icon: Layers },
    { to: '/admin/policy', label: 'Inactivity Policy', icon: Timer },
    { to: '/admin/analytics', label: 'Usage Analytics', icon: BarChart3 },
    { to: '/admin/settings', label: 'System Settings', icon: Settings },
  ],
};

export const ROLE_TITLE = { student: 'Student Portal', faculty: 'Faculty Console', admin: 'Admin Console' };
export const ROLE_ICON = { student: TerminalSquare, faculty: BookOpen, admin: ShieldCheck };
