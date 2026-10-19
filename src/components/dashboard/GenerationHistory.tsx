import { createClient } from "@/lib/supabase/server";
import StatusAction from "./StatusAction";
import ExportActions from "./ExportActions";
import DraftEditor from "./DraftEditor";
import { isContentPackage, type ContentPackage } from "@/lib/ai/content/contentPackage";
import { PLATFORM_CONFIGS, resolvePlatformFromMetadata } from "@/lib/ai/platform/config";
import { listConnectedMetaAccounts } from "@/lib/publishing/connections/query";
import type { ConnectedAccountSummary } from "@/lib/publishing/connections/types";
import { readFacebookPublishState, requireFacebookSlides, selectedFacebookPage } from "@/lib/publishing/publishFacebookPost";
import { resolveFacebookText } from "@/lib/ai/content/facebookText";
import { ATLAS_DEFAULT_BUSINESS_PROFILE } from "@/lib/ai/context/businessProfile";
import PublishPanel, { type PlatformPanelInfo } from "./PublishPanel";

type GeneratedPost = {
  id: string;
  created_at: string;
  content: string;
  visual_headline: string;
  final_image_url: string;
  status: string;
  // Untyped JSON column — generate-visual/route.ts writes { platform, ... }
  // into it, but rows created before the platform feature existed have no
  // "platform" key at all, so this is read defensively (via
  // resolvePlatformFromMetadata) rather than assumed.
  metadata: unknown;
};

// Draft Edit applies to carousel drafts that carry their structured
// ContentPackage (every package-pipeline carousel since Gold Standard V1);
// older/legacy rows simply show no "Düzenle" button.
function editableDraft(post: GeneratedPost): { contentPackage: ContentPackage; images: { slide: number; imageUrl: string }[] } | null {
  if (post.status !== "draft" || !post.metadata || typeof post.metadata !== "object") return null;
  const { contentPackage, carouselImages } = post.metadata as { contentPackage?: unknown; carouselImages?: unknown };
  if (!isContentPackage(contentPackage) || contentPackage.format !== "carousel") return null;
  const images = Array.isArray(carouselImages)
    ? carouselImages.filter(
        (image): image is { slide: number; imageUrl: string } =>
          Boolean(image) && typeof image.imageUrl === "string" && typeof image.slide === "number",
      )
    : [];
  return { contentPackage, images };
}

// Server Component, self-contained: fetches its own user + rows rather than
// receiving props from dashboard/page.tsx, so page.tsx's change stays to a
// single import + grid entry. Must never throw — a history-load failure is
// caught and rendered as a quiet inline message, never allowed to break the
// rest of the dashboard.
export default async function GenerationHistory() {
  let posts: GeneratedPost[] | null = null;
  let facebookPage: ConnectedAccountSummary | undefined;
  let instagramAccount: ConnectedAccountSummary | undefined;
  let loadError = false;

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      const { data, error } = await supabase
        .from("generated_posts")
        .select("id, created_at, content, visual_headline, final_image_url, status, metadata")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(24);

      if (error) {
        console.error("Generation history select error:", error);
        loadError = true;
      } else {
        posts = data;
      }
      const accounts = await listConnectedMetaAccounts(supabase, user.id);
      facebookPage = selectedFacebookPage(accounts);
      instagramAccount = accounts.find((account) => account.platform === "instagram" && account.hasCredential);
    }
  } catch (error) {
    console.error("Generation history exception:", error);
    loadError = true;
  }

  return (
    <section className="animate-fade-up rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
      <h2 className="text-base font-semibold text-white">Oluşturulan Gönderiler</h2>

      {loadError ? (
        <p className="mt-4 text-sm text-zinc-400">Geçmiş şu anda yüklenemedi. Lütfen daha sonra tekrar deneyin.</p>
      ) : !posts || posts.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-400">
          Henüz oluşturulmuş bir gönderi yok. Bir görsel oluşturduğunuzda burada görünecek.
        </p>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {posts.map((post) => {
            const draft = editableDraft(post);
            return (
            // A <form>/<button> (in StatusAction) can't legally nest inside
            // an <a> — the previous version wrapped the whole card in one
            // anchor. Minimal structural change: the anchor now wraps only
            // the image; everything else is unchanged.
            <div
              key={post.id}
              className="group overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950 transition-colors hover:border-indigo-500/40"
            >
              <a href={post.final_image_url} target="_blank" rel="noopener noreferrer" className="block">
                {/* eslint-disable-next-line @next/next/no-img-element -- dynamic external Supabase Storage URL, same pattern as AIAssistantPanel.tsx */}
                <img
                  src={post.final_image_url}
                  alt={post.visual_headline}
                  className="aspect-[4/5] w-full object-cover"
                />
              </a>
              <div className="p-3">
                <span className="inline-block rounded-full border border-indigo-500/30 bg-indigo-500/10 px-2.5 py-1 text-[11px] font-medium text-indigo-300">
                  {PLATFORM_CONFIGS[resolvePlatformFromMetadata(post.metadata)].label}
                </span>
                <p className="mt-1.5 line-clamp-2 text-sm font-medium text-white">{post.visual_headline}</p>
                <p className="mt-1 line-clamp-1 text-xs text-zinc-400">{post.content}</p>
                <p className="mt-1 text-xs text-zinc-500">
                  {new Date(post.created_at).toLocaleDateString("tr-TR", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </p>
                <StatusAction postId={post.id} status={post.status} />
                {draft && (
                  <DraftEditor
                    postId={post.id}
                    contentPackage={draft.contentPackage}
                    images={draft.images}
                    facebookText={resolveFacebookText(post.metadata, post.content, ATLAS_DEFAULT_BUSINESS_PROFILE.geography.primary)}
                  />
                )}
                <PostPublishPanel post={post} instagram={instagramAccount} facebook={facebookPage} />
                <ExportActions postId={post.id} content={post.content} finalImageUrl={post.final_image_url} />
              </div>
            </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// The explicit publish step for an approved post: per-platform state from
// the row (Instagram = generated_posts.status "posted"; Facebook =
// metadata.publishResults.facebook), what each platform will publish, and
// which platforms can be ticked right now. Approving alone never publishes.
function PostPublishPanel({
  post,
  instagram,
  facebook,
}: {
  post: GeneratedPost;
  instagram: ConnectedAccountSummary | undefined;
  facebook: ConnectedAccountSummary | undefined;
}) {
  if (post.status !== "approved" && post.status !== "posted") return null;

  const instagramPublished = post.status === "posted";
  const instagramInfo: PlatformPanelInfo = {
    status: instagramPublished ? "published" : "pending",
    unavailable: instagramPublished ? "Instagram'da paylaşıldı." : !instagram ? "Instagram hesabı bağlı değil." : null,
    preview: post.content,
    account: instagram?.externalAccountName ?? undefined,
  };

  const facebookState = readFacebookPublishState(post.metadata);
  const facebookPublished = facebookState?.state === "published";
  const check = facebook?.multiPhotoCheck;
  const facebookInfo: PlatformPanelInfo = {
    status: facebookPublished ? "published" : facebookState?.state === "failed" ? "failed" : "pending",
    failureMessage: facebookState?.state === "failed" ? facebookState.error : undefined,
    unavailable: facebookPublished
      ? "Facebook'ta paylaşıldı."
      : !facebook
        ? "Facebook Sayfası bağlı değil."
        : !requireFacebookSlides(post.metadata)
          ? "Facebook için 5 carousel görselinin tamamı gerekli."
          : !(check?.ok && check.count >= 5)
            ? "Önce Bağlı Hesaplar'dan Facebook çoklu görsel testini çalıştırın."
            : null,
    preview: resolveFacebookText(post.metadata, post.content, ATLAS_DEFAULT_BUSINESS_PROFILE.geography.primary),
    account: facebook ? (facebook.externalAccountName ?? facebook.externalAccountId) : undefined,
  };

  return <PublishPanel postId={post.id} platforms={{ instagram: instagramInfo, facebook: facebookInfo }} />;
}
