import React from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface BreadcrumbProps {
  items: BreadcrumbItem[];
}

export function Breadcrumb({ items }: BreadcrumbProps) {
  return (
    <nav className="flex items-center text-xs text-slate-500 whitespace-nowrap overflow-x-auto no-scrollbar">
      {items.map((item, index) => {
        const isLast = index === items.length - 1;
        
        return (
          <React.Fragment key={index}>
            {index > 0 && (
              <ChevronRight className="w-3 h-3 mx-1.5 text-slate-400 shrink-0" />
            )}
            {item.href && !isLast ? (
              <Link 
                href={item.href}
                className="hover:text-blue-600 transition-colors font-medium truncate max-w-[150px]"
                title={item.label}
              >
                {item.label}
              </Link>
            ) : (
              <span 
                className={`truncate max-w-[150px] ${isLast ? 'text-slate-800 dark:text-slate-200 font-semibold' : 'font-medium'}`}
                title={item.label}
              >
                {item.label}
              </span>
            )}
          </React.Fragment>
        );
      })}
    </nav>
  );
}
