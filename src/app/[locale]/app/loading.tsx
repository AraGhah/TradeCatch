export default function AppLoading() {
  return (
    <div className="flex flex-col gap-6" aria-hidden="true">
      <div className="h-8 w-56 animate-pulse rounded-md bg-navy/10" />
      <div className="h-4 w-full max-w-xl animate-pulse rounded-md bg-navy/10" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 8 }, (_, index) => (
          <div key={index} className="h-28 animate-pulse rounded-xl bg-white" />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-xl bg-white" />
      <div className="h-48 animate-pulse rounded-xl bg-white" />
    </div>
  );
}
