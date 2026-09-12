import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return <div className="container-page py-16"><Skeleton className="h-3 w-40 rounded-none" /><Skeleton className="mt-5 h-20 max-w-3xl rounded-none" /><div className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-64 rounded-none" />)}</div></div>;
}
