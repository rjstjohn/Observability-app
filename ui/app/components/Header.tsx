import React from "react";
import { Link, useLocation } from "react-router-dom";
import { AppHeader } from "@dynatrace/strato-components-preview/layouts";

const NAV = [
  { to: "/", label: "Overview" },
  { to: "/coverage", label: "Coverage & Health" },
  { to: "/app", label: "Application Detail" },
  { to: "/recommendations", label: "Recommendations" },
  { to: "/explorer", label: "Explorer" },
];

export const Header = () => {
  const { pathname } = useLocation();
  const isActive = (to: string) =>
    to === "/" ? pathname === "/" : pathname === to || pathname.startsWith(to + "/");

  return (
    <AppHeader>
      <AppHeader.Navigation>
        <AppHeader.Logo as={Link} to="/" />
        {NAV.map((item) => (
          <AppHeader.NavigationItem key={item.to} as={Link} to={item.to} isSelected={isActive(item.to)}>
            {item.label}
          </AppHeader.NavigationItem>
        ))}
      </AppHeader.Navigation>
    </AppHeader>
  );
};
