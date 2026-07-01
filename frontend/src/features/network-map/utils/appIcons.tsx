import { ReactElement } from 'react';
import GroupsIcon from '@mui/icons-material/Groups';
import VideocamIcon from '@mui/icons-material/Videocam';
import ForumIcon from '@mui/icons-material/Forum';
import LanguageIcon from '@mui/icons-material/Language';
import PublicIcon from '@mui/icons-material/Public';
import CodeIcon from '@mui/icons-material/Code';
import MailOutlineIcon from '@mui/icons-material/MailOutline';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import TerminalIcon from '@mui/icons-material/Terminal';
import AppsIcon from '@mui/icons-material/Apps';
import DnsIcon from '@mui/icons-material/Dns';
import ComputerIcon from '@mui/icons-material/Computer';
import BlockIcon from '@mui/icons-material/Block';
import VpnLockIcon from '@mui/icons-material/VpnLock';
import RouterIcon from '@mui/icons-material/Router';
import GavelIcon from '@mui/icons-material/Gavel';
import SettingsEthernetIcon from '@mui/icons-material/SettingsEthernet';
import TagIcon from '@mui/icons-material/Tag';

export interface AppIconStyle {
  icon: ReactElement;
  color: string;
  bg: string;
}

const APP_ICON_MAP: Record<string, AppIconStyle> = {
  microsoft_teams: { icon: <GroupsIcon fontSize="small" />, color: '#6264A7', bg: 'rgba(98, 100, 167, 0.14)' },
  zoom: { icon: <VideocamIcon fontSize="small" />, color: '#2D8CFF', bg: 'rgba(45, 140, 255, 0.14)' },
  slack: { icon: <ForumIcon fontSize="small" />, color: '#4A154B', bg: 'rgba(74, 21, 75, 0.12)' },
  safari: { icon: <PublicIcon fontSize="small" />, color: '#006CFF', bg: 'rgba(0, 108, 255, 0.12)' },
  google_chrome: { icon: <LanguageIcon fontSize="small" />, color: '#4285F4', bg: 'rgba(66, 133, 244, 0.12)' },
  microsoft_edge: { icon: <LanguageIcon fontSize="small" />, color: '#0078D4', bg: 'rgba(0, 120, 212, 0.12)' },
  vscode: { icon: <CodeIcon fontSize="small" />, color: '#007ACC', bg: 'rgba(0, 122, 204, 0.12)' },
  cursor: { icon: <TerminalIcon fontSize="small" />, color: '#7C3AED', bg: 'rgba(124, 58, 237, 0.12)' },
  apple_mail: { icon: <MailOutlineIcon fontSize="small" />, color: '#007AFF', bg: 'rgba(0, 122, 255, 0.12)' },
  finder: { icon: <FolderOpenIcon fontSize="small" />, color: '#5AC8FA', bg: 'rgba(90, 200, 250, 0.14)' },
};

export function getAppIconStyle(slug?: string | null): AppIconStyle {
  if (slug && APP_ICON_MAP[slug]) {
    return APP_ICON_MAP[slug];
  }
  return {
    icon: <AppsIcon fontSize="small" />,
    color: '#64748B',
    bg: 'rgba(100, 116, 139, 0.12)',
  };
}

export function getDeviceIconStyle(): AppIconStyle {
  return {
    icon: <ComputerIcon fontSize="small" />,
    color: '#0F766E',
    bg: 'rgba(15, 118, 110, 0.12)',
  };
}

export function getDomainIconStyle(blocked?: boolean | null): AppIconStyle {
  if (blocked) {
    return {
      icon: <BlockIcon fontSize="small" />,
      color: '#D32F2F',
      bg: 'rgba(211, 47, 47, 0.1)',
    };
  }
  return {
    icon: <DnsIcon fontSize="small" />,
    color: '#1565C0',
    bg: 'rgba(21, 101, 192, 0.1)',
  };
}

export function getInfraIconStyle(type: 'tunnel' | 'gateway' | 'policy'): AppIconStyle {
  if (type === 'tunnel') {
    return {
      icon: <VpnLockIcon fontSize="small" />,
      color: '#6D28D9',
      bg: 'rgba(109, 40, 217, 0.12)',
    };
  }
  if (type === 'gateway') {
    return {
      icon: <RouterIcon fontSize="small" />,
      color: '#0369A1',
      bg: 'rgba(3, 105, 161, 0.12)',
    };
  }
  return {
    icon: <GavelIcon fontSize="small" />,
    color: '#B45309',
    bg: 'rgba(180, 83, 9, 0.12)',
  };
}

export function getPortIconStyle(): AppIconStyle {
  return {
    icon: <TagIcon fontSize="small" />,
    color: '#7C3AED',
    bg: 'rgba(124, 58, 237, 0.12)',
  };
}

export function getFlowIconStyle(): AppIconStyle {
  return {
    icon: <SettingsEthernetIcon fontSize="small" />,
    color: '#0E7490',
    bg: 'rgba(14, 116, 144, 0.12)',
  };
}

export function getNodeIconStyle(node: {
  type: string;
  app_slug?: string | null;
  blocked?: boolean | null;
}): AppIconStyle {
  if (node.type === 'device') {
    return getDeviceIconStyle();
  }
  if (node.type === 'app') {
    return getAppIconStyle(node.app_slug);
  }
  if (node.type === 'domain') {
    return getDomainIconStyle(node.blocked);
  }
  if (node.type === 'flow') {
    return getFlowIconStyle();
  }
  if (node.type === 'port') {
    return getPortIconStyle();
  }
  if (node.type === 'tunnel' || node.type === 'gateway' || node.type === 'policy') {
    return getInfraIconStyle(node.type);
  }
  return getAppIconStyle(null);
}
