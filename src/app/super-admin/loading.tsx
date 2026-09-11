import { Skeleton } from "@/components/common/Skeleton";

export default function SuperAdminLoading() {
  return (
    <div className="flex-1 overflow-auto bg-slate-50 dark:bg-slate-900/50 p-6">
      <div className="max-w-6xl mx-auto space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <Skeleton className="w-48 h-8 mb-2" />
            <Skeleton className="w-64 h-4" />
          </div>
          <Skeleton className="w-32 h-10 rounded-md" />
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="p-6 bg-white dark:bg-slate-800 rounded-xl border border-slate-300 dark:border-slate-700 shadow-sm">
              <Skeleton className="w-10 h-10 rounded-lg mb-4" />
              <Skeleton className="w-24 h-4 mb-2" />
              <Skeleton className="w-16 h-8" />
            </div>
          ))}
        </div>

        {/* Main Content Area - Tabs */}
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-300 dark:border-slate-700 shadow-sm overflow-hidden">
          <div className="border-b border-slate-300 dark:border-slate-700 p-2 flex gap-2">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="w-24 h-9 rounded-md" />
            ))}
          </div>
          
          <div className="p-6 space-y-6">
            <div className="flex justify-between items-center mb-4">
              <Skeleton className="w-48 h-6" />
              <Skeleton className="w-64 h-9 rounded-md" />
            </div>

            {/* Table Skeleton */}
            <div className="border border-slate-300 dark:border-slate-700 rounded-lg overflow-hidden">
              <div className="flex gap-4 p-4 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-300 dark:border-slate-700">
                <Skeleton className="w-1/4 h-4" />
                <Skeleton className="w-1/4 h-4" />
                <Skeleton className="w-1/4 h-4" />
                <Skeleton className="w-1/4 h-4" />
              </div>
              <div className="divide-y divide-slate-100 dark:divide-slate-700/50">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="flex gap-4 p-4">
                    <Skeleton className="w-1/4 h-4" />
                    <Skeleton className="w-1/4 h-4" />
                    <div className="w-1/4"><Skeleton className="w-16 h-6 rounded-full" /></div>
                    <div className="w-1/4 flex gap-2 justify-end">
                      <Skeleton className="w-8 h-8 rounded-md" />
                      <Skeleton className="w-8 h-8 rounded-md" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
