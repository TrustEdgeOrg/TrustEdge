import { useState, useEffect } from 'react';
import { useLocation, Link } from 'react-router-dom';
import { useTheme } from '@mui/material/styles';
import { sidebarNavItemSx, sidebarSectionButtonSx } from '../../../shared/theme/navigationChrome';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Collapse from '@mui/material/Collapse';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import ExpandLess from '@mui/icons-material/ExpandLess';
import ExpandMore from '@mui/icons-material/ExpandMore';
import HomeRoundedIcon from '@mui/icons-material/HomeRounded';
import RouterIcon from '@mui/icons-material/Router';
import PolicyIcon from '@mui/icons-material/Policy';
import PublicIcon from '@mui/icons-material/Public';
import AnalyticsIcon from '@mui/icons-material/Analytics';
import DevicesOtherIcon from '@mui/icons-material/DevicesOther';
import BlockIcon from '@mui/icons-material/Block';
import MapIcon from '@mui/icons-material/Map';
import HubIcon from '@mui/icons-material/Hub';
import './MenuContent.css';

const mainListItems = [
  { text: 'Home', icon: <HomeRoundedIcon />, path: '/', iconClass: 'homeIcon' },
];

const manageNetworkItems = [
  { text: 'Policy', icon: <PolicyIcon />, path: '/policy', iconClass: 'policyIcon' },
  {
    text: 'Country access',
    icon: <PublicIcon />,
    path: '/policy/countries',
    iconClass: 'countryAccessIcon',
  },
  { text: 'Client map', icon: <MapIcon />, path: '/client-map', iconClass: 'clientMapIcon' },
  { text: 'Network map', icon: <HubIcon />, path: '/network-map', iconClass: 'networkMapIcon' },
];

const analyticsItems = [
  { text: 'Client profiles', icon: <DevicesOtherIcon />, path: '/client-profiles', iconClass: 'clientProfilesIcon' },
  { text: 'Blocked clients', icon: <BlockIcon />, path: '/blocked-clients', iconClass: 'blockedClientsIcon' },
  // TODO: add Reports & Activity Logs when implemented
];

const secondaryListItems = [];

interface MenuContentProps {
  open?: boolean;
}

export default function MenuContent({ open = true }: MenuContentProps) {
  const theme = useTheme();
  const location = useLocation();
  const [manageNetworkOpen, setManageNetworkOpen] = useState(true);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const navItemSx = sidebarNavItemSx(theme);
  const nestedNavItemSx = sidebarNavItemSx(theme, true);
  const sectionSx = sidebarSectionButtonSx(theme);

  useEffect(() => {
    const hasSelectedChild = manageNetworkItems.some(item => location.pathname === item.path);
    if (hasSelectedChild) {
      setManageNetworkOpen(true);
    }
    const hasSelectedAnalytics = analyticsItems.some(item => location.pathname === item.path);
    if (hasSelectedAnalytics) {
      setAnalyticsOpen(true);
    }
  }, [location.pathname]);

  const handleManageNetworkClick = () => {
    setManageNetworkOpen(!manageNetworkOpen);
  };

  const handleAnalyticsClick = () => {
    setAnalyticsOpen(!analyticsOpen);
  };

  const renderNavItem = (item: typeof mainListItems[0], index: number) => {
    const isSelected = location.pathname === item.path;
    const button = (
      <ListItemButton
        component={Link}
        to={item.path}
        selected={isSelected}
        className="azure-sidebar-item"
        sx={navItemSx}
      >
        <ListItemIcon
          className={`menuIcon ${item.iconClass}`}
          sx={{
            minWidth: open ? 40 : 'auto',
            justifyContent: open ? 'flex-start' : 'center',
          }}
        >
          {item.icon}
        </ListItemIcon>
        {open && (
          <ListItemText
            primary={item.text}
            sx={{ color: isSelected ? 'text.primary' : 'text.secondary' }}
            primaryTypographyProps={{
              fontSize: '0.875rem',
              fontWeight: isSelected ? 500 : 400,
            }}
          />
        )}
      </ListItemButton>
    );

    return (
      <ListItem key={index} disablePadding sx={{ display: 'block' }}>
        {!open ? (
          <Tooltip title={item.text} placement="right" arrow>
            <span>{button}</span>
          </Tooltip>
        ) : (
          button
        )}
      </ListItem>
    );
  };

  return (
    <Stack sx={{ flexGrow: 1, p: 1, justifyContent: 'space-between' }}>
      <List dense sx={{ px: 0 }}>
        {mainListItems.map((item, index) => renderNavItem(item, index))}
        
        {open && (
          <>
            <ListItem disablePadding sx={{ display: 'block' }}>
              <ListItemButton
                onClick={handleManageNetworkClick}
                sx={sectionSx}
              >
                <ListItemIcon
                  className="menuIcon"
                  sx={{
                    minWidth: 40,
                    justifyContent: 'flex-start',
                  }}
                >
                  <RouterIcon />
                </ListItemIcon>
                <ListItemText
                  primary="My network"
                  sx={{ color: 'text.secondary' }}
                  primaryTypographyProps={{
                    fontSize: '0.875rem',
                    fontWeight: 400,
                  }}
                />
                {manageNetworkOpen ? <ExpandLess /> : <ExpandMore />}
              </ListItemButton>
            </ListItem>
            <Collapse in={manageNetworkOpen} timeout="auto" unmountOnExit>
              <List component="div" disablePadding dense>
                {manageNetworkItems.map((item, index) => {
                  const isSelected = location.pathname === item.path;
                  const button = (
                    <ListItemButton
                      component={Link}
                      to={item.path}
                      selected={isSelected}
                      className="azure-sidebar-item"
                      sx={nestedNavItemSx}
                    >
                      <ListItemIcon
                        className={`menuIcon ${item.iconClass}`}
                        sx={{
                          minWidth: 40,
                          justifyContent: 'flex-start',
                        }}
                      >
                        {item.icon}
                      </ListItemIcon>
                      <ListItemText
                        primary={item.text}
                        sx={{ color: isSelected ? 'text.primary' : 'text.secondary' }}
                        primaryTypographyProps={{
                          fontSize: '0.875rem',
                          fontWeight: isSelected ? 500 : 400,
                        }}
                      />
                    </ListItemButton>
                  );

                  return (
                    <ListItem key={index} disablePadding sx={{ display: 'block' }}>
                      {button}
                    </ListItem>
                  );
                })}
              </List>
            </Collapse>
          </>
        )}
        
        {open && (
          <>
            <ListItem disablePadding sx={{ display: 'block' }}>
              <ListItemButton
                onClick={handleAnalyticsClick}
                sx={sectionSx}
              >
                <ListItemIcon
                  className="menuIcon"
                  sx={{
                    minWidth: 40,
                    justifyContent: 'flex-start',
                  }}
                >
                  <AnalyticsIcon />
                </ListItemIcon>
                <ListItemText
                  primary="Analytics"
                  sx={{ color: 'text.secondary' }}
                  primaryTypographyProps={{
                    fontSize: '0.875rem',
                    fontWeight: 400,
                  }}
                />
                {analyticsOpen ? <ExpandLess /> : <ExpandMore />}
              </ListItemButton>
            </ListItem>
            <Collapse in={analyticsOpen} timeout="auto" unmountOnExit>
              <List component="div" disablePadding dense>
                {analyticsItems.map((item, index) => {
                  const isSelected = location.pathname === item.path;
                  const button = (
                    <ListItemButton
                      component={Link}
                      to={item.path}
                      selected={isSelected}
                      className="azure-sidebar-item"
                      sx={nestedNavItemSx}
                    >
                      <ListItemIcon
                        className={`menuIcon ${item.iconClass}`}
                        sx={{
                          minWidth: 40,
                          justifyContent: 'flex-start',
                        }}
                      >
                        {item.icon}
                      </ListItemIcon>
                      <ListItemText
                        primary={item.text}
                        sx={{ color: isSelected ? 'text.primary' : 'text.secondary' }}
                        primaryTypographyProps={{
                          fontSize: '0.875rem',
                          fontWeight: isSelected ? 500 : 400,
                        }}
                      />
                    </ListItemButton>
                  );

                  return (
                    <ListItem key={index} disablePadding sx={{ display: 'block' }}>
                      {button}
                    </ListItem>
                  );
                })}
              </List>
            </Collapse>
          </>
        )}

        {!open && (
          <>
            {manageNetworkItems.map((item, index) => {
              const isSelected = location.pathname === item.path;
              const button = (
                <ListItemButton
                  component={Link}
                  to={item.path}
                  selected={isSelected}
                  className="azure-sidebar-item"
                  sx={navItemSx}
                >
                  <ListItemIcon
                    className={`menuIcon ${item.iconClass}`}
                    sx={{
                      minWidth: 'auto',
                      justifyContent: 'center',
                    }}
                  >
                    {item.icon}
                  </ListItemIcon>
                </ListItemButton>
              );

              return (
                <ListItem key={`collapsed-${index}`} disablePadding sx={{ display: 'block' }}>
                  <Tooltip title={item.text} placement="right" arrow>
                    <span>{button}</span>
                  </Tooltip>
                </ListItem>
              );
            })}
            {analyticsItems.map((item, index) => {
              const isSelected = location.pathname === item.path;
              const button = (
                <ListItemButton
                  component={Link}
                  to={item.path}
                  selected={isSelected}
                  className="azure-sidebar-item"
                  sx={navItemSx}
                >
                  <ListItemIcon
                    className={`menuIcon ${item.iconClass}`}
                    sx={{
                      minWidth: 'auto',
                      justifyContent: 'center',
                    }}
                  >
                    {item.icon}
                  </ListItemIcon>
                </ListItemButton>
              );

              return (
                <ListItem key={`collapsed-analytics-${index}`} disablePadding sx={{ display: 'block' }}>
                  <Tooltip title={item.text} placement="right" arrow>
                    <span>{button}</span>
                  </Tooltip>
                </ListItem>
              );
            })}
          </>
        )}
      </List>
      <List dense sx={{ px: 0 }}>
        {secondaryListItems.map((item, index) => {
          const isSelected = location.pathname === item.path;
          const button = (
            <ListItemButton
              component={Link}
              to={item.path}
              selected={isSelected}
              className="azure-sidebar-item"
              sx={navItemSx}
            >
              <ListItemIcon
                className={`menuIcon ${item.iconClass}`}
                sx={{
                  minWidth: open ? 40 : 'auto',
                  justifyContent: open ? 'flex-start' : 'center',
                }}
              >
                {item.icon}
              </ListItemIcon>
              {open && (
                <ListItemText
                  primary={item.text}
                  sx={{ color: isSelected ? 'text.primary' : 'text.secondary' }}
                  primaryTypographyProps={{
                    fontSize: '0.875rem',
                    fontWeight: isSelected ? 500 : 400,
                  }}
                />
              )}
            </ListItemButton>
          );

          return (
            <ListItem key={index} disablePadding sx={{ display: 'block' }}>
              {!open ? (
                <Tooltip title={item.text} placement="right" arrow>
                  <span>{button}</span>
                </Tooltip>
              ) : (
                button
              )}
            </ListItem>
          );
        })}
      </List>
    </Stack>
  );
}
