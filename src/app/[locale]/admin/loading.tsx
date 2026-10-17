export default function AdminLoading() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-hidden>
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="h-24 animate-pulse rounded-md bg-navy/5" />
      ))}
    </div>
  );
}
