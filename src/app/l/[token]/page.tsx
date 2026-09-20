import { notFound } from "next/navigation";
import { ListView } from "@/components/ListView";
import { getList, ListError } from "@/lib/lists/service";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ token: string }> };

export async function generateMetadata({ params }: Props) {
  const { token } = await params;
  try {
    const list = await getList(token);
    return { title: `${list.name} · Ostoslista` };
  } catch {
    return { title: "Ostoslista" };
  }
}

/**
 * The shared list.
 *
 * Rendered on the server so opening a link shows the list immediately rather
 * than a spinner — the link is usually tapped from a chat app on a phone.
 */
export default async function ListPage({ params }: Props) {
  const { token } = await params;

  let list: Awaited<ReturnType<typeof getList>>;
  try {
    list = await getList(token);
  } catch (error) {
    if (error instanceof ListError && error.status === 404) notFound();
    throw error;
  }

  const base = process.env.NEXT_PUBLIC_APP_URL ?? "";
  return <ListView list={list} shareUrl={`${base}/l/${token}`} />;
}
