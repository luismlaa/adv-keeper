import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { loadDisplayMessages } from "@/lib/chat/chat-view";
import { defaultChatDeps } from "@/lib/chat/deps";
import { chatCookieName, verifyWebIdentity } from "@/lib/chat/web-identity";
import { getServerEnv } from "@/lib/config/env";
import { ChatWindow } from "./_components/chat-window";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#075e54",
};

async function loadBusiness(slug: string) {
  if (!/^[a-z0-9-]{1,64}$/.test(slug)) return null;
  return defaultChatDeps().store.getBusinessBySlug(slug);
}

export async function generateMetadata({ params }: PageProps<"/chat/[slug]">): Promise<Metadata> {
  const business = await loadBusiness((await params).slug);
  return { title: business ? `${business.name} · Chat` : "Chat · Keeper" };
}

export default async function ChatPage({ params }: PageProps<"/chat/[slug]">) {
  const { slug } = await params;
  const business = await loadBusiness(slug);
  if (!business) notFound();

  const env = getServerEnv();
  const phone = verifyWebIdentity((await cookies()).get(chatCookieName(business.slug))?.value, env.ENCRYPTION_KEY);
  const initialMessages = phone === null ? [] : await loadDisplayMessages(defaultChatDeps().conversations, business.id, phone, "web");

  return <ChatWindow slug={business.slug} businessName={business.name} initialMessages={initialMessages} />;
}
