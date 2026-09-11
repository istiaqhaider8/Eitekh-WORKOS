import { Skeleton } from "@/components/common/Skeleton";

export default function ProjectLoading() {
  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* Header Skeleton */}
      <header className="h-14 border-b border-border bg-card flex items-center justify-between px-4 sticky top-0 z-10 shrink-0">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Skeleton className="w-8 h-8 rounded-lg" />
            <Skeleton className="w-32 h-6" />
          </div>
          <div className="hidden sm:flex items-center gap-1">
            <Skeleton className="w-24 h-6 rounded-md" />
            <Skeleton className="w-24 h-6 rounded-md" />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="w-8 h-8 rounded-full" />
          <Skeleton className="w-8 h-8 rounded-full" />
          <Skeleton className="w-24 h-8 rounded-lg" />
        </div>
      </header>

      {/* Main Content Skeleton */}
      <main className="flex-1 overflow-auto bg-background p-4 md:p-6">
        <div className="flex flex-col md:flex-row gap-6">
          <div className="flex-1 space-y-6">
            {/* Title Area */}
            <div className="space-y-2">
              <Skeleton className="w-16 h-5" />
              <Skeleton className="w-3/4 h-8" />
            </div>

            {/* Description Area */}
            <div className="space-y-3">
              <Skeleton className="w-full h-4" />
              <Skeleton className="w-full h-4" />
              <Skeleton className="w-2/3 h-4" />
            </div>

            {/* Tabs / Sections */}
            <div className="flex gap-4 border-b border-border pb-2">
              <Skeleton className="w-16 h-6" />
              <Skeleton className="w-16 h-6" />
              <Skeleton className="w-16 h-6" />
            </div>

            {/* Content List */}
            <div className="space-y-3 pt-4">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="flex gap-4 p-4 border border-border rounded-lg bg-card">
                  <Skeleton className="w-6 h-6 rounded-md shrink-0" />
                  <div className="space-y-2 w-full">
                    <Skeleton className="w-1/2 h-5" />
                    <Skeleton className="w-1/4 h-4" />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Sidebar Area */}
          <div className="w-full md:w-72 lg:w-80 shrink-0 space-y-6">
            <div className="p-4 border border-border rounded-lg bg-card space-y-4">
              <Skeleton className="w-32 h-5 mb-4" />
              <div className="space-y-3">
                <div className="flex justify-between">
                  <Skeleton className="w-20 h-4" />
                  <Skeleton className="w-24 h-4" />
                </div>
                <div className="flex justify-between">
                  <Skeleton className="w-20 h-4" />
                  <Skeleton className="w-24 h-4" />
                </div>
                <div className="flex justify-between">
                  <Skeleton className="w-20 h-4" />
                  <Skeleton className="w-24 h-4" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
