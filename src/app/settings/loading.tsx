import { Skeleton } from "@/components/common/Skeleton";

export default function SettingsLoading() {
  return (
    <div className="max-w-2xl space-y-6">
      <Skeleton className="h-7 w-48" />
      <div className="space-y-4 p-6 border border-slate-200 dark:border-slate-800 rounded-xl">
        <Skeleton className="h-5 w-32 mb-4" />
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="space-y-1">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-9 w-full rounded-lg" />
          </div>
        ))}
        <Skeleton className="h-9 w-28 rounded-lg mt-2" />
      </div>
      <div className="space-y-3 p-6 border border-slate-200 dark:border-slate-800 rounded-xl">
        <Skeleton className="h-5 w-32 mb-4" />
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Skeleton className="w-8 h-8 rounded-full" />
              <div className="space-y-1">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-3 w-40" />
              </div>
            </div>
            <Skeleton className="h-6 w-16 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
