import type { SvgIconProps } from '@mui/material/SvgIcon';
import GitHubIcon from '@mui/icons-material/GitHub';
import HubOutlinedIcon from '@mui/icons-material/HubOutlined';
import StorageOutlinedIcon from '@mui/icons-material/StorageOutlined';
import TagIcon from '@mui/icons-material/Tag';
import BuildOutlinedIcon from '@mui/icons-material/BuildOutlined';
import SearchIcon from '@mui/icons-material/Search';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import SendOutlinedIcon from '@mui/icons-material/SendOutlined';

const SERVER_COLORS: Record<string, string> = {
  github: '#24292F',
  slack: '#4A154B',
  'customer-db': '#0D9373',
};

export function mcpServerIconColor(server: string): string {
  return SERVER_COLORS[server.trim().toLowerCase()] || '#0288D1';
}

export function mcpServerIcon(server: string, props?: SvgIconProps) {
  const key = server.trim().toLowerCase();
  const merged: SvgIconProps = { fontSize: 'small', ...props };
  if (key === 'github') return <GitHubIcon {...merged} />;
  if (key === 'slack') return <TagIcon {...merged} />;
  if (key.includes('db') || key.includes('database') || key.includes('postgres')) {
    return <StorageOutlinedIcon {...merged} />;
  }
  return <HubOutlinedIcon {...merged} />;
}

export function mcpToolIcon(tool: string, props?: SvgIconProps) {
  const name = tool.trim().toLowerCase();
  const merged: SvgIconProps = { sx: { fontSize: 16 }, ...props };
  if (name.includes('search') || name.includes('list') || name.includes('read') || name.includes('get')) {
    return <SearchIcon {...merged} />;
  }
  if (name.includes('create') || name.includes('update') || name.includes('write') || name.includes('push')) {
    return <EditOutlinedIcon {...merged} />;
  }
  if (name.includes('post') || name.includes('send') || name.includes('reply')) {
    return <SendOutlinedIcon {...merged} />;
  }
  return <BuildOutlinedIcon {...merged} />;
}
