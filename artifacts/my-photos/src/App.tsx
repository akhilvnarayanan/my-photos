import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  Archive,
  Check,
  ArrowLeft,
  ArrowRight,
  Camera,
  CircleAlert,
  CloudOff,
  Download,
  FolderHeart,
  FolderOpen,
  HardDrive,
  Heart,
  Image as ImageIcon,
  Import,
  KeyRound,
  LayoutGrid,
  LoaderCircle,
  LogOut,
  Maximize2,
  MapPin,
  Menu,
  Pause,
  Play,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  Video,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { Link, Route, Switch, useLocation, useParams, Router as WouterRouter } from 'wouter';
import {
  getGetImportQueryKey,
  getGetPhotoQueryKey,
  getGetSessionQueryKey,
  getGetStatsQueryKey,
  getListAlbumsQueryKey,
  getListImportsQueryKey,
  getListPhotosQueryKey,
  getDownloadPhotoQueryKey,
  useAddPhotosToAlbum,
  useCancelImport,
  useConfirmImport,
  useCreateAlbum,
  useDeleteAlbum,
  useDeletePhoto,
  useDownloadPhoto,
  useGetImport,
  useGetPhoto,
  useGetSession,
  useGetStats,
  useListAlbums,
  useListImports,
  useListPhotos,
  useListPlaces,
  useLogin,
  useLogout,
  usePauseImport,
  useResumeImport,
  useRetryImport,
  useRemovePhotoFromAlbum,
  useRestorePhoto,
  usePermanentlyDeletePhoto,
  useEmptyTrash,
  useStartImport,
  uploadBrowserFile,
  useToggleFavorite,
  useToggleArchive,
  useUpdateAlbum,
  useHealthCheck,
  type Album,
  type ImportJob,
  type Photo,
} from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient();

const cn = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');
const fmtDate = (date?: string | null, style: 'long' | 'short' = 'long') => {
  if (!date) return 'No date yet';
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return date;
  return new Intl.DateTimeFormat('en', style === 'long' ? { month: 'long', year: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' }).format(parsed);
};
const fmtBytes = (bytes = 0) => {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
};
const pct = (job?: ImportJob | null) => job?.totalFiles ? Math.min(100, Math.round((job.processedFiles / job.totalFiles) * 100)) : 0;

function Logo() {
  return (
    <Link href="/" className="flex items-center gap-3" data-testid="link-logo">
      <span className="flex h-10 w-10 items-center justify-center rounded-[14px] bg-secondary text-primary shadow-sm">
        <Camera size={20} strokeWidth={2.4} />
      </span>
      <span className="leading-none">
        <span className="block font-serif text-[22px] italic tracking-tight text-sidebar-foreground">my photos</span>
        <span className="mt-1 block font-mono text-[9px] uppercase tracking-[.22em] text-sidebar-foreground/45">local / private</span>
      </span>
    </Link>
  );
}

const navItems = [
  { href: '/', label: 'All moments', icon: LayoutGrid },
  { href: '/favorites', label: 'Favorites', icon: Heart },
  { href: '/albums', label: 'Albums', icon: Archive },
  { href: '/places', label: 'Places', icon: MapPin },
];

function Shell({ children }: { children: ReactNode }) {
  const [location, setLocation] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const sessionQuery = useGetSession();
  const logout = useLogout();
  const isAuthRoute = location === '/login';
  useEffect(() => {
    if (sessionQuery.data && !sessionQuery.data.authenticated) setLocation('/login');
  }, [sessionQuery.data, setLocation]);
  if (isAuthRoute) return <>{children}</>;
  if (sessionQuery.isLoading) return <Splash />;
  if (sessionQuery.data && !sessionQuery.data.authenticated) {
    return <Splash />;
  }
  const doLogout = () => logout.mutate(undefined, { onSuccess: () => { queryClient.clear(); setLocation('/login'); } });
  return (
    <div className="grain min-h-[100dvh] bg-background text-foreground">
      <aside className={cn('fixed inset-y-0 left-0 z-40 flex w-[252px] flex-col bg-sidebar px-5 py-6 text-sidebar-foreground transition-transform duration-300 md:translate-x-0', mobileOpen ? 'translate-x-0' : '-translate-x-full')}>
        <div className="flex items-center justify-between"><Logo /><button onClick={() => setMobileOpen(false)} className="rounded-lg p-2 text-sidebar-foreground/60 md:hidden" data-testid="button-close-menu"><X size={18} /></button></div>
        <div className="mt-12">
          <p className="mb-3 px-3 font-mono text-[10px] uppercase tracking-[.2em] text-sidebar-foreground/35">Library</p>
          <nav className="space-y-1">
            {navItems.map(({ href, label, icon: Icon }) => {
              const active = href === '/' ? location === '/' : location.startsWith(href);
              return <Link key={href} href={href} onClick={() => setMobileOpen(false)} className={cn('group flex items-center gap-3 rounded-xl px-3 py-3 text-[13px] font-semibold transition-colors', active ? 'bg-sidebar-accent text-secondary' : 'text-sidebar-foreground/65 hover:bg-sidebar-accent/75 hover:text-sidebar-foreground')} data-testid={`link-nav-${label.toLowerCase().replaceAll(' ', '-')}`}><Icon size={17} strokeWidth={active ? 2.4 : 1.8} /><span>{label}</span>{label === 'Favorites' && <span className="ml-auto text-[11px] font-mono text-sidebar-foreground/35">⌘F</span>}</Link>;
            })}
          </nav>
        </div>
        <div className="mt-9">
          <p className="mb-3 px-3 font-mono text-[10px] uppercase tracking-[.2em] text-sidebar-foreground/35">Library tools</p>
          <nav className="space-y-1">
            <Link href="/archive" onClick={() => setMobileOpen(false)} className={cn('flex items-center gap-3 rounded-xl px-3 py-3 text-[13px] font-semibold', location === '/archive' ? 'bg-sidebar-accent text-secondary' : 'text-sidebar-foreground/65 hover:bg-sidebar-accent hover:text-sidebar-foreground')} data-testid="link-nav-archive"><Archive size={17} /><span>Archive</span></Link>
            <Link href="/trash" onClick={() => setMobileOpen(false)} className={cn('flex items-center gap-3 rounded-xl px-3 py-3 text-[13px] font-semibold', location === '/trash' ? 'bg-sidebar-accent text-secondary' : 'text-sidebar-foreground/65 hover:bg-sidebar-accent hover:text-sidebar-foreground')} data-testid="link-nav-trash"><Trash2 size={17} /><span>Trash</span></Link>
            <Link href="/import" onClick={() => setMobileOpen(false)} className={cn('flex items-center gap-3 rounded-xl px-3 py-3 text-[13px] font-semibold', location === '/import' ? 'bg-sidebar-accent text-secondary' : 'text-sidebar-foreground/65 hover:bg-sidebar-accent hover:text-sidebar-foreground')} data-testid="link-nav-import"><Import size={17} /><span>Import archive</span></Link>
             <Link href="/upload" onClick={() => setMobileOpen(false)} className={cn('flex items-center gap-3 rounded-xl px-3 py-3 text-[13px] font-semibold', location === '/upload' ? 'bg-sidebar-accent text-secondary' : 'text-sidebar-foreground/65 hover:bg-sidebar-accent hover:text-sidebar-foreground')} data-testid="link-nav-upload"><Upload size={17} /><span>Upload</span></Link>
            <Link href="/settings" onClick={() => setMobileOpen(false)} className={cn('flex items-center gap-3 rounded-xl px-3 py-3 text-[13px] font-semibold', location === '/settings' ? 'bg-sidebar-accent text-secondary' : 'text-sidebar-foreground/65 hover:bg-sidebar-accent hover:text-sidebar-foreground')} data-testid="link-nav-settings"><Settings size={17} /><span>Settings</span></Link>
          </nav>
        </div>
        <div className="mt-auto rounded-2xl border border-sidebar-border bg-sidebar-accent/40 p-4">
          <div className="flex items-center gap-2 text-secondary"><ShieldCheck size={15} /><span className="font-mono text-[10px] uppercase tracking-widest">On this device</span></div>
          <p className="mt-2 text-xs leading-relaxed text-sidebar-foreground/55">Originals stay on your local library. Nothing leaves this home.</p>
        </div>
        <button onClick={doLogout} className="mt-5 flex items-center gap-3 px-3 py-2 text-[12px] font-semibold text-sidebar-foreground/45 hover:text-sidebar-foreground" data-testid="button-logout"><LogOut size={15} />Sign out</button>
      </aside>
      {mobileOpen && <button className="fixed inset-0 z-30 bg-primary/30 md:hidden" onClick={() => setMobileOpen(false)} aria-label="Close navigation" data-testid="button-overlay-menu" />}
      <main className="min-h-[100dvh] md:pl-[252px]">
        <header className="sticky top-0 z-20 flex h-[76px] items-center justify-between border-b border-border/70 bg-background/90 px-5 backdrop-blur-md md:px-10">
          <button onClick={() => setMobileOpen(true)} className="rounded-xl p-2 text-muted-foreground hover:bg-muted md:hidden" data-testid="button-open-menu"><Menu size={20} /></button>
          <div className="hidden font-mono text-[10px] uppercase tracking-[.2em] text-muted-foreground md:block">Your visual archive</div>
          <div className="ml-auto flex items-center gap-3">
            <div className="hidden items-center gap-2 rounded-full border border-border bg-card px-3 py-2 text-[11px] text-muted-foreground sm:flex"><CloudOff size={13} className="text-accent" />Local only</div>
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent/15 font-serif text-sm italic text-accent" data-testid="text-user-avatar">{sessionQuery.data?.username?.slice(0, 1).toUpperCase() || 'M'}</span>
          </div>
        </header>
        {children}
      </main>
    </div>
  );
}

function Splash() {
  return <div className="flex min-h-[100dvh] items-center justify-center bg-background"><div className="text-center"><span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-secondary text-primary"><Camera size={22} /></span><p className="mt-4 font-serif text-xl italic">opening your archive</p><div className="mx-auto mt-4 h-1 w-24 overflow-hidden rounded-full bg-muted"><div className="h-full w-1/2 animate-pulse bg-accent" /></div></div></div>;
}

function PageIntro({ eyebrow, title, description, action }: { eyebrow: string; title: string; description?: string; action?: ReactNode }) {
  return <div className="mb-8 flex flex-col justify-between gap-5 md:flex-row md:items-end"><div><p className="mb-3 font-mono text-[10px] uppercase tracking-[.22em] text-accent" data-testid={`text-eyebrow-${eyebrow.toLowerCase().replaceAll(' ', '-')}`}>{eyebrow}</p><h1 className="font-serif text-4xl italic tracking-tight text-primary md:text-[48px]" data-testid={`heading-${title.toLowerCase().replaceAll(' ', '-')}`}>{title}</h1>{description && <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">{description}</p>}</div>{action}</div>;
}

function Toolbar({ query, setQuery, filter, setFilter }: { query: string; setQuery: (v: string) => void; filter: string; setFilter: (v: string) => void }) {
  return <div className="mb-8 flex flex-col gap-3 sm:flex-row"><label className="relative flex-1"><Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" /><input value={query} onChange={(e) => setQuery(e.target.value)} type="search" placeholder="Search your archive" className="h-12 w-full rounded-xl border border-border bg-card pl-11 pr-4 text-sm outline-none transition-shadow placeholder:text-muted-foreground/60 focus:ring-2 focus:ring-secondary" data-testid="input-search-photos" /></label><div className="flex items-center gap-1 rounded-xl border border-border bg-card p-1"><button onClick={() => setFilter('all')} className={cn('flex h-10 items-center gap-2 rounded-lg px-4 text-xs font-bold', filter === 'all' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-primary')} data-testid="button-filter-all"><LayoutGrid size={14} />All</button><button onClick={() => setFilter('photo')} className={cn('flex h-10 items-center gap-2 rounded-lg px-4 text-xs font-bold', filter === 'photo' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-primary')} data-testid="button-filter-photos"><ImageIcon size={14} />Photos</button><button onClick={() => setFilter('video')} className={cn('flex h-10 items-center gap-2 rounded-lg px-4 text-xs font-bold', filter === 'video' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-primary')} data-testid="button-filter-videos"><Video size={14} />Video</button></div></div>;
}

function MediaCard({ photo, onOpen, onFavorite, onArchive, pending, archivePending }: { photo: Photo; onOpen: (photo: Photo) => void; onFavorite: (photo: Photo) => void; onArchive?: (photo: Photo) => void; pending?: boolean; archivePending?: boolean }) {
  return <article className="group relative mb-3 overflow-hidden rounded-2xl bg-muted/50 shadow-sm transition-transform duration-300 hover:-translate-y-1 hover:shadow-lg" data-testid={`card-photo-${photo.id}`}>
    <button className="block w-full text-left" onClick={() => onOpen(photo)} data-testid={`button-open-photo-${photo.id}`}><img src={photo.thumbnailUrl || photo.mediumUrl} alt={photo.filename} className="max-h-[420px] w-full object-cover transition-transform duration-500 group-hover:scale-[1.035]" loading="lazy" /><span className="absolute inset-x-0 bottom-0 flex items-end justify-between bg-gradient-to-t from-primary/80 to-transparent px-4 pb-3 pt-12 opacity-0 transition-opacity group-hover:opacity-100"><span className="max-w-[75%] truncate text-[11px] font-medium text-primary-foreground">{photo.filename}</span>{photo.mediaType === 'video' && <span className="flex h-7 w-7 items-center justify-center rounded-full bg-secondary text-primary"><Play size={12} fill="currentColor" /></span>}</span></button>
     <button onClick={() => onFavorite(photo)} disabled={pending} className={cn('absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full backdrop-blur-md transition-all', photo.isFavorite ? 'bg-secondary text-primary' : 'bg-primary/45 text-primary-foreground opacity-0 group-hover:opacity-100 hover:bg-secondary hover:text-primary')} data-testid={`button-favorite-photo-${photo.id}`} aria-label={photo.isFavorite ? 'Remove from favorites' : 'Add to favorites'}>{pending ? <LoaderCircle size={14} className="animate-spin" /> : <Heart size={15} fill={photo.isFavorite ? 'currentColor' : 'none'} />}</button>
     {onArchive && <button onClick={() => onArchive(photo)} disabled={archivePending} className={cn('absolute right-3 top-12 flex h-8 w-8 items-center justify-center rounded-full bg-primary/45 text-primary-foreground opacity-0 backdrop-blur-md transition-all group-hover:opacity-100 hover:bg-secondary hover:text-primary', photo.isArchived && 'bg-secondary text-primary opacity-100')} data-testid={`button-archive-photo-${photo.id}`} aria-label={photo.isArchived ? 'Restore from archive' : 'Archive photo'}>{archivePending ? <LoaderCircle size={14} className="animate-spin" /> : <Archive size={14} />}</button>}
  </article>;
}

function MediaSkeleton() {
  return <div className="columns-2 gap-3 md:columns-3 lg:columns-4">{[220, 310, 180, 270, 340, 210, 290, 240].map((height, i) => <div key={i} className="skeleton-line mb-3 break-inside-avoid rounded-2xl bg-muted" style={{ height }} />)}</div>;
}

function EmptyState({ icon: Icon, title, description, action }: { icon: typeof ImageIcon; title: string; description: string; action?: ReactNode }) {
  return <div className="rounded-3xl border border-dashed border-border bg-card/60 px-6 py-20 text-center"><span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-secondary/25 text-accent"><Icon size={25} strokeWidth={1.6} /></span><h2 className="mt-5 font-serif text-2xl italic text-primary">{title}</h2><p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">{description}</p>{action && <div className="mt-6">{action}</div>}</div>;
}

function ErrorState({ retry }: { retry: () => void }) {
  return <div className="rounded-3xl border border-accent/25 bg-accent/5 px-6 py-16 text-center"><CircleAlert className="mx-auto text-accent" size={26} /><h2 className="mt-4 font-serif text-xl italic text-primary">The archive is taking a breath</h2><p className="mt-2 text-sm text-muted-foreground">We could not reach your local library right now.</p><button onClick={retry} className="mt-5 rounded-lg bg-primary px-4 py-2 text-xs font-bold text-primary-foreground" data-testid="button-retry-query">Try again</button></div>;
}

function Viewer({ photo, onClose, onFavorite, onArchive, onNext, onPrevious, onDelete, isPending }: { photo: Photo; onClose: () => void; onFavorite: (p: Photo) => void; onArchive?: (p: Photo) => void; onNext: () => void; onPrevious: () => void; onDelete?: (p: Photo) => void; isPending: boolean }) {
  const detailQuery = useGetPhoto(photo.id, { query: { queryKey: getGetPhotoQueryKey(photo.id) } });
  const downloadQuery = useDownloadPhoto(photo.id, { query: { enabled: false, queryKey: getDownloadPhotoQueryKey(photo.id) } });
  const albumsQuery = useListAlbums();
  const addToAlbum = useAddPhotosToAlbum();
  const [zoom, setZoom] = useState(1);
  const [showAlbums, setShowAlbums] = useState(false);
  const shown = detailQuery.data || photo;
  useEffect(() => setZoom(1), [photo.id]);
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowLeft') onPrevious();
      if (event.key === 'ArrowRight') onNext();
      if (event.code === 'Space') {
        event.preventDefault();
        onFavorite(shown);
      }
       if (event.key.toLowerCase() === 'a' && onArchive) onArchive(shown);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
   }, [onArchive, onClose, onNext, onPrevious, onFavorite, shown]);
  const download = async () => {
    const result = await downloadQuery.refetch();
    if (result.data) {
      const href = URL.createObjectURL(result.data);
      const link = document.createElement('a');
      link.href = href;
      link.download = shown.filename;
      link.click();
      URL.revokeObjectURL(href);
    }
  };
  return <div className="fixed inset-0 z-50 flex flex-col bg-primary/95 text-primary-foreground backdrop-blur-sm" role="dialog" aria-modal="true">
    <div className="flex items-center justify-between px-5 py-4 md:px-8"><button onClick={onClose} className="flex items-center gap-2 text-xs font-bold text-primary-foreground/70 hover:text-primary-foreground" data-testid="button-close-viewer"><span className="flex h-9 w-9 items-center justify-center rounded-full border border-primary-foreground/20"><X size={17} /></span><span className="hidden sm:block">Close</span></button><span className="font-mono text-[10px] uppercase tracking-[.22em] text-primary-foreground/45">{shown.mediaType === 'video' ? 'Video' : 'Photograph'} / {fmtDate(shown.captureDate, 'short')}</span><div className="flex items-center gap-2"><button onClick={() => setZoom((value) => Math.max(1, value - 0.25))} className="hidden h-9 w-9 items-center justify-center rounded-full border border-primary-foreground/20 hover:bg-primary-foreground/10 sm:flex" data-testid="button-zoom-out" aria-label="Zoom out"><ZoomOut size={15} /></button><button onClick={() => setZoom((value) => Math.min(2.5, value + 0.25))} className="hidden h-9 w-9 items-center justify-center rounded-full border border-primary-foreground/20 hover:bg-primary-foreground/10 sm:flex" data-testid="button-zoom-in" aria-label="Zoom in"><ZoomIn size={15} /></button><button onClick={() => document.documentElement.requestFullscreen?.()} className="hidden h-9 w-9 items-center justify-center rounded-full border border-primary-foreground/20 hover:bg-primary-foreground/10 sm:flex" data-testid="button-fullscreen" aria-label="Enter full screen"><Maximize2 size={15} /></button><div className="relative"><button onClick={() => setShowAlbums((value) => !value)} className="flex h-9 w-9 items-center justify-center rounded-full border border-primary-foreground/20 hover:bg-primary-foreground/10" data-testid="button-viewer-album"><FolderHeart size={15} /></button>{showAlbums && <div className="absolute right-0 top-11 z-20 w-52 rounded-2xl border border-primary-foreground/15 bg-primary p-2 shadow-2xl"><p className="px-3 py-2 font-mono text-[9px] uppercase tracking-wider text-primary-foreground/45">Add to album</p>{albumsQuery.data?.length ? albumsQuery.data.map((album) => <button key={album.id} disabled={addToAlbum.isPending || shown.albumIds.includes(album.id)} onClick={() => addToAlbum.mutate({ albumId: album.id, data: { photoIds: [shown.id] } }, { onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListAlbumsQueryKey() }); setShowAlbums(false); } })} className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-xs hover:bg-primary-foreground/10 disabled:cursor-not-allowed disabled:opacity-40" data-testid={`button-viewer-add-album-${album.id}`}><span className="truncate">{album.name}</span>{shown.albumIds.includes(album.id) && <span className="font-mono text-[9px]">Added</span>}</button>) : <p className="px-3 py-2 text-xs text-primary-foreground/50">Create an album first.</p>}</div>}</div><button onClick={() => onFavorite(shown)} className="flex h-9 w-9 items-center justify-center rounded-full border border-primary-foreground/20 hover:bg-primary-foreground/10" data-testid="button-viewer-favorite"><Heart size={16} fill={shown.isFavorite ? 'currentColor' : 'none'} className={shown.isFavorite ? 'text-secondary' : ''} /></button><button onClick={download} disabled={downloadQuery.isFetching} className="flex h-9 w-9 items-center justify-center rounded-full border border-primary-foreground/20 hover:bg-primary-foreground/10" data-testid="button-download-photo">{downloadQuery.isFetching ? <LoaderCircle size={16} className="animate-spin" /> : <Download size={16} />}</button>{onDelete && <button onClick={() => onDelete(shown)} className="flex h-9 w-9 items-center justify-center rounded-full border border-primary-foreground/20 text-primary-foreground/60 hover:bg-destructive/30 hover:text-primary-foreground" data-testid="button-delete-photo"><Trash2 size={15} /></button>}</div></div>
    <div className="relative flex min-h-0 flex-1 items-center justify-center px-4 pb-6"><button onClick={onPrevious} className="absolute left-3 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-primary-foreground/10 hover:bg-primary-foreground/20 md:left-8" data-testid="button-previous-photo"><ArrowLeft size={19} /></button><div className="flex max-h-full max-w-[min(86vw,1100px)] flex-col items-center"><div className="relative max-h-[72vh] overflow-auto rounded-2xl bg-primary-foreground/5 shadow-2xl"><img src={shown.mediumUrl || shown.originalUrl} alt={shown.filename} className="max-h-[72vh] max-w-full object-contain transition-transform duration-200" style={{ transform: `scale(${zoom})` }} />{shown.mediaType === 'video' && <span className="absolute left-1/2 top-1/2 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-secondary text-primary shadow-xl"><Play size={23} fill="currentColor" /></span>}</div><div className="mt-4 max-w-full text-center"><p className="truncate text-sm font-semibold">{shown.filename}</p><p className="mt-1 font-mono text-[10px] text-primary-foreground/45">{shown.width || '—'} × {shown.height || '—'} · {fmtBytes(shown.fileSize)}</p></div></div><button onClick={onNext} className="absolute right-3 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-primary-foreground/10 hover:bg-primary-foreground/20 md:right-8" data-testid="button-next-photo"><ArrowRight size={19} /></button></div>
  </div>;
}

function Timeline({ favoritesOnly = false, archivedOnly = false }: { favoritesOnly?: boolean; archivedOnly?: boolean }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [favPending, setFavPending] = useState<string | null>(null);
   const params = useMemo(() => ({ limit: 100, ...(query ? { query } : {}), ...(filter !== 'all' ? { mediaType: filter as 'photo' | 'video' } : {}), ...(favoritesOnly ? { favorite: true } : {}), ...(archivedOnly ? { archived: true } : {}) }), [archivedOnly, favoritesOnly, filter, query]);
  const photosQuery = useListPhotos(params);
  const toggle = useToggleFavorite();
   const archive = useToggleArchive();
  const deleteMutation = useDeletePhoto();
  const items = photosQuery.data?.items || [];
   const favorite = (photo: Photo) => { setFavPending(photo.id); toggle.mutate({ photoId: photo.id, data: { isFavorite: !photo.isFavorite } }, { onSettled: () => setFavPending(null), onSuccess: () => queryClient.invalidateQueries({ queryKey: getListPhotosQueryKey(params) }) }); };
   const toggleArchive = (photo: Photo) => { archive.mutate({ photoId: photo.id, data: { isArchived: !photo.isArchived } }, { onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListPhotosQueryKey(params) }); queryClient.invalidateQueries({ queryKey: getListPhotosQueryKey() }); } }); };
   const deletePhoto = (photo: Photo) => { if (window.confirm(`Move “${photo.filename}” to Trash? You can restore it later.`)) deleteMutation.mutate({ photoId: photo.id }, { onSuccess: () => { setViewerIndex(null); queryClient.invalidateQueries({ queryKey: getListPhotosQueryKey() }); queryClient.invalidateQueries({ queryKey: getGetStatsQueryKey() }); } }); };
  const grouped = useMemo(() => items.reduce<Record<string, Photo[]>>((acc, photo) => { const key = new Date(photo.captureDate).getFullYear().toString(); (acc[key] ||= []).push(photo); return acc; }, {}), [items]);
   return <section className="px-5 py-9 md:px-10 md:py-12"><PageIntro eyebrow={favoritesOnly ? 'A small constellation' : archivedOnly ? 'Set aside, still safe' : 'Your archive'} title={favoritesOnly ? 'Favorites' : archivedOnly ? 'Archive' : 'All moments'} description={favoritesOnly ? 'The photographs you have marked to keep close.' : archivedOnly ? 'Moments tucked away from the main view, still searchable and still part of every album.' : 'A quiet, chronological view of the moments you chose to keep.'} /><Toolbar query={query} setQuery={setQuery} filter={filter} setFilter={setFilter} />
     {photosQuery.isLoading ? <MediaSkeleton /> : photosQuery.isError ? <ErrorState retry={() => photosQuery.refetch()} /> : items.length === 0 ? <EmptyState icon={favoritesOnly ? Heart : archivedOnly ? Archive : Camera} title={favoritesOnly ? 'Nothing held close yet' : archivedOnly ? 'Your archive is clear' : query ? 'No matching moments' : 'Your archive is still empty'} description={favoritesOnly ? 'Tap the heart on any photograph to gather your favorites here.' : archivedOnly ? 'Archived moments remain safe and can be brought back whenever you need them.' : query ? 'Try a different filename, place, or date.' : 'Start with a Google Takeout archive and make this space yours.'} action={!favoritesOnly && !archivedOnly && <Link href="/import" className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-3 text-xs font-bold text-primary-foreground" data-testid="link-empty-import"><Upload size={15} />Import your archive</Link>} /> : <>{Object.entries(grouped).sort(([a], [b]) => Number(b) - Number(a)).map(([year, yearItems], groupIndex) => <div key={year} className={cn('animate-drift mb-10', `stagger-${Math.min(groupIndex + 1, 4)}`)}><div className="mb-4 flex items-center gap-4"><h2 className="font-mono text-[11px] font-medium tracking-[.18em] text-muted-foreground" data-testid={`heading-year-${year}`}>{year}</h2><span className="h-px flex-1 bg-border" /><span className="font-mono text-[10px] text-muted-foreground/60">{yearItems.length} {yearItems.length === 1 ? 'moment' : 'moments'}</span></div><div className="photo-grid">{yearItems.map((photo) => <MediaCard key={photo.id} photo={photo} onOpen={() => setViewerIndex(items.findIndex((item) => item.id === photo.id))} onFavorite={favorite} onArchive={toggleArchive} archivePending={archive.isPending && archive.variables?.photoId === photo.id} pending={favPending === photo.id} />)}</div></div>)}</>}
     {viewerIndex !== null && items[viewerIndex] && <Viewer photo={items[viewerIndex]} onClose={() => setViewerIndex(null)} onFavorite={favorite} onArchive={toggleArchive} onDelete={deletePhoto} isPending={favPending === items[viewerIndex].id} onPrevious={() => setViewerIndex((viewerIndex - 1 + items.length) % items.length)} onNext={() => setViewerIndex((viewerIndex + 1) % items.length)} />}
   </section>;
}

function TrashPage() {
  const [query, setQuery] = useState('');
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const params = useMemo(() => ({ limit: 100, trashed: true, ...(query ? { query } : {}) }), [query]);
  const photosQuery = useListPhotos(params);
  const restore = useRestorePhoto();
  const permanent = usePermanentlyDeletePhoto();
  const empty = useEmptyTrash();
  const toggle = useToggleFavorite();
  const items = photosQuery.data?.items || [];
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: getListPhotosQueryKey(params) });
    queryClient.invalidateQueries({ queryKey: getListPhotosQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetStatsQueryKey() });
  };
  const restorePhoto = (photo: Photo) => restore.mutate({ photoId: photo.id }, { onSuccess: refresh });
  const permanentlyDelete = (photo: Photo) => {
    if (window.confirm(`Permanently delete “${photo.filename}”? The original file cannot be recovered.`)) {
      permanent.mutate({ photoId: photo.id }, { onSuccess: refresh });
    }
  };
  const emptyAll = () => {
    if (window.confirm('Permanently delete every item in Trash? This cannot be undone.')) empty.mutate(undefined, { onSuccess: refresh });
  };
  const favorite = (photo: Photo) => toggle.mutate({ photoId: photo.id, data: { isFavorite: !photo.isFavorite } }, { onSuccess: refresh });
  return <section className="px-5 py-9 md:px-10 md:py-12">
    <PageIntro eyebrow="A safe second chance" title="Trash" description="Deleted moments stay here until you decide otherwise. Restore them to the library or clear them permanently." action={items.length > 0 && <button onClick={emptyAll} disabled={empty.isPending} className="inline-flex items-center justify-center gap-2 rounded-xl border border-destructive/30 px-4 py-3 text-xs font-bold text-destructive hover:bg-destructive/10 disabled:opacity-40" data-testid="button-empty-trash"><Trash2 size={15} />{empty.isPending ? 'Emptying…' : 'Empty trash'}</button>} />
    <label className="relative mb-8 block max-w-xl"><Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" /><input value={query} onChange={(event) => setQuery(event.target.value)} type="search" placeholder="Search deleted moments" className="h-12 w-full rounded-xl border border-border bg-card pl-11 pr-4 text-sm outline-none focus:ring-2 focus:ring-secondary" data-testid="input-search-trash" /></label>
    {photosQuery.isLoading ? <MediaSkeleton /> : photosQuery.isError ? <ErrorState retry={() => photosQuery.refetch()} /> : items.length === 0 ? <EmptyState icon={Trash2} title={query ? 'No deleted matches' : 'Trash is empty'} description={query ? 'Try another filename or description.' : 'Deleted moments will appear here before anything is removed permanently.'} /> : <div className="photo-grid">{items.map((photo) => <article key={photo.id} className="group relative mb-3 overflow-hidden rounded-2xl border border-border bg-card shadow-sm" data-testid={`card-trash-photo-${photo.id}`}><button onClick={() => setViewerIndex(items.indexOf(photo))} className="block w-full text-left" data-testid={`button-open-trash-photo-${photo.id}`}><img src={photo.thumbnailUrl || photo.mediumUrl} alt={photo.filename} className="w-full object-cover opacity-75 transition-transform duration-500 group-hover:scale-[1.03]" loading="lazy" /><span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-primary/90 to-transparent px-3 pb-16 pt-12 text-[11px] text-primary-foreground">{photo.filename}</span></button><div className="flex items-center justify-between border-t border-border px-3 py-2"><button onClick={() => restorePhoto(photo)} disabled={restore.isPending} className="rounded-lg px-2 py-1.5 text-[11px] font-bold text-primary hover:bg-secondary/25 disabled:opacity-40" data-testid={`button-restore-photo-${photo.id}`}><Check size={13} className="mr-1 inline" />Restore</button><button onClick={() => permanentlyDelete(photo)} disabled={permanent.isPending} className="rounded-lg px-2 py-1.5 text-[11px] font-bold text-destructive hover:bg-destructive/10 disabled:opacity-40" data-testid={`button-permanent-delete-photo-${photo.id}`}>Delete forever</button></div></article>)}</div>}
    {viewerIndex !== null && items[viewerIndex] && <Viewer photo={items[viewerIndex]} onClose={() => setViewerIndex(null)} onFavorite={favorite} onPrevious={() => setViewerIndex((viewerIndex - 1 + items.length) % items.length)} onNext={() => setViewerIndex((viewerIndex + 1) % items.length)} isPending={toggle.isPending} />}
  </section>;
}

function Albums() {
  const albumsQuery = useListAlbums();
  const [dialog, setDialog] = useState<'create' | 'rename' | null>(null);
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<Album | null>(null);
  const create = useCreateAlbum();
  const update = useUpdateAlbum();
  const remove = useDeleteAlbum();
  const albums = albumsQuery.data || [];
  const submit = (e: FormEvent) => { e.preventDefault(); if (!name.trim()) return; if (dialog === 'create') create.mutate({ data: { name: name.trim() } }, { onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListAlbumsQueryKey() }); setDialog(null); setName(''); } }); else if (editing) update.mutate({ albumId: editing.id, data: { name: name.trim() } }, { onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListAlbumsQueryKey() }); setDialog(null); setEditing(null); setName(''); } }); };
  const removeAlbum = (album: Album) => { if (window.confirm(`Delete the album “${album.name}”? Your photographs will stay safe.`)) remove.mutate({ albumId: album.id }, { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListAlbumsQueryKey() }) }); };
  return <section className="px-5 py-9 md:px-10 md:py-12"><PageIntro eyebrow="Curated chapters" title="Albums" description="Small, intentional collections for the stories that deserve their own cover." action={<button onClick={() => { setDialog('create'); setName(''); }} className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-xs font-bold text-primary-foreground shadow-sm transition-transform hover:-translate-y-0.5" data-testid="button-create-album"><Plus size={15} />New album</button>} />
    {albumsQuery.isLoading ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"><div className="h-64 animate-pulse rounded-3xl bg-muted" /><div className="h-64 animate-pulse rounded-3xl bg-muted" /><div className="h-64 animate-pulse rounded-3xl bg-muted" /></div> : albumsQuery.isError ? <ErrorState retry={() => albumsQuery.refetch()} /> : albums.length === 0 ? <EmptyState icon={FolderHeart} title="Make room for a story" description="Albums are a gentle way to group the moments that belong together." action={<button onClick={() => { setDialog('create'); setName(''); }} className="rounded-xl bg-primary px-4 py-3 text-xs font-bold text-primary-foreground" data-testid="button-empty-create-album">Create first album</button>} /> : <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{albums.map((album, i) => <article key={album.id} className={cn('group animate-drift overflow-hidden rounded-3xl border border-border bg-card shadow-sm transition-all hover:-translate-y-1 hover:shadow-xl', `stagger-${Math.min(i + 1, 4)}`)} data-testid={`card-album-${album.id}`}><Link href={`/albums/${album.id}`} className="block" data-testid={`link-album-${album.id}`}><div className="relative aspect-[1.15] overflow-hidden bg-secondary/20">{album.coverUrl ? <img src={album.coverUrl} alt={album.name} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" /> : <div className="flex h-full items-center justify-center text-accent/60"><FolderOpen size={42} strokeWidth={1} /></div>}<span className="absolute bottom-3 left-3 rounded-full bg-primary/70 px-2.5 py-1 font-mono text-[10px] text-primary-foreground backdrop-blur-md">{album.photoCount} items</span></div><div className="p-5"><h2 className="font-serif text-2xl italic text-primary">{album.name}</h2><p className="mt-1 text-xs text-muted-foreground">Updated {fmtDate(album.updatedAt)}</p></div></Link><div className="flex items-center justify-end gap-1 border-t border-border/70 px-4 py-3"><button onClick={() => { setEditing(album); setName(album.name); setDialog('rename'); }} className="rounded-lg px-3 py-1.5 text-[11px] font-bold text-muted-foreground hover:bg-muted hover:text-primary" data-testid={`button-rename-album-${album.id}`}>Rename</button><button onClick={() => removeAlbum(album)} className="rounded-lg p-2 text-muted-foreground hover:bg-accent/10 hover:text-destructive" data-testid={`button-delete-album-${album.id}`}><Trash2 size={14} /></button></div></article>)}</div>}
    {dialog && <div className="fixed inset-0 z-50 flex items-center justify-center bg-primary/30 p-5 backdrop-blur-sm"><form onSubmit={submit} className="w-full max-w-md rounded-3xl border border-border bg-card p-6 shadow-2xl animate-drift"><div className="flex items-center justify-between"><h2 className="font-serif text-2xl italic text-primary">{dialog === 'create' ? 'New album' : 'Rename album'}</h2><button type="button" onClick={() => setDialog(null)} className="rounded-full p-2 text-muted-foreground hover:bg-muted" data-testid="button-close-album-dialog"><X size={17} /></button></div><label className="mt-6 block text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Album name<input autoFocus value={name} onChange={(e) => setName(e.target.value)} className="mt-2 h-12 w-full rounded-xl border border-border bg-background px-4 text-sm outline-none focus:ring-2 focus:ring-secondary" placeholder="e.g. Summer at the lake" data-testid="input-album-name" /></label><div className="mt-6 flex justify-end gap-2"><button type="button" onClick={() => setDialog(null)} className="rounded-xl px-4 py-3 text-xs font-bold text-muted-foreground hover:bg-muted" data-testid="button-cancel-album">Cancel</button><button disabled={create.isPending || update.isPending} className="rounded-xl bg-primary px-4 py-3 text-xs font-bold text-primary-foreground" data-testid="button-save-album">{create.isPending || update.isPending ? 'Saving…' : 'Save album'}</button></div></form></div>}
  </section>;
}

function AlbumDetail() {
  const { id = '' } = useParams<{ id: string }>();
  const albumsQuery = useListAlbums();
  const photosQuery = useListPhotos({ albumId: id, limit: 100 });
  const allPhotosQuery = useListPhotos({ limit: 100 });
  const [adding, setAdding] = useState(false);
  const [viewer, setViewer] = useState<Photo | null>(null);
  const add = useAddPhotosToAlbum();
  const remove = useRemovePhotoFromAlbum();
  const toggle = useToggleFavorite();
  const album = albumsQuery.data?.find((item) => item.id === id);
  const albumPhotos = photosQuery.data?.items || [];
  const available = (allPhotosQuery.data?.items || []).filter((photo) => !photo.albumIds?.includes(id)).slice(0, 8);
  if (albumsQuery.isLoading || photosQuery.isLoading) return <section className="px-5 py-10 md:px-10"><div className="h-10 w-56 animate-pulse rounded bg-muted" /><div className="mt-8"><MediaSkeleton /></div></section>;
  if (!album) return <section className="px-5 py-10 md:px-10"><EmptyState icon={FolderOpen} title="Album not found" description="This chapter may have been removed or has not arrived from the library yet." action={<Link href="/albums" className="rounded-xl bg-primary px-4 py-3 text-xs font-bold text-primary-foreground" data-testid="link-back-albums">Back to albums</Link>} /></section>;
  return <section className="px-5 py-9 md:px-10 md:py-12"><Link href="/albums" className="mb-8 inline-flex items-center gap-2 text-xs font-bold text-muted-foreground hover:text-primary" data-testid="link-back-to-albums"><ArrowLeft size={14} />All albums</Link><PageIntro eyebrow={`${album.photoCount} moments`} title={album.name} description={`Created ${fmtDate(album.createdAt)} · Last updated ${fmtDate(album.updatedAt)}`} action={<button onClick={() => setAdding(!adding)} className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-3 text-xs font-bold text-primary-foreground" data-testid="button-toggle-add-photos"><Plus size={15} />Add moments</button>} />
    {adding && <div className="mb-8 rounded-2xl border border-secondary/50 bg-secondary/10 p-5"><div className="flex items-center justify-between"><div><h2 className="font-semibold text-primary">Add to this album</h2><p className="mt-1 text-xs text-muted-foreground">Choose from your latest moments.</p></div><button onClick={() => setAdding(false)} className="rounded-full p-2 text-muted-foreground hover:bg-secondary/30" data-testid="button-close-add-photos"><X size={16} /></button></div>{available.length ? <div className="mt-4 flex gap-3 overflow-x-auto pb-1">{available.map((photo) => <button key={photo.id} disabled={add.isPending} onClick={() => add.mutate({ albumId: id, data: { photoIds: [photo.id] } }, { onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListPhotosQueryKey({ albumId: id, limit: 100 }) }); queryClient.invalidateQueries({ queryKey: getListAlbumsQueryKey() }); } })} className="group relative h-20 w-20 shrink-0 overflow-hidden rounded-xl" data-testid={`button-add-photo-${photo.id}`}><img src={photo.thumbnailUrl} alt={photo.filename} className="h-full w-full object-cover transition-transform group-hover:scale-110" /><span className="absolute inset-0 flex items-center justify-center bg-primary/0 text-secondary transition-colors group-hover:bg-primary/50"><Plus size={17} /></span></button>)}</div> : <p className="mt-4 text-xs text-muted-foreground">Every recent moment is already in this album.</p>}</div>}
    {photosQuery.isError ? <ErrorState retry={() => photosQuery.refetch()} /> : albumPhotos.length === 0 ? <EmptyState icon={FolderOpen} title="A story waiting to happen" description="This album has no moments yet. Add a few from your library to give it a beginning." /> : <div className="photo-grid">{albumPhotos.map((photo) => <article key={photo.id} className="group relative mb-3 overflow-hidden rounded-2xl"><button onClick={() => setViewer(photo)} className="block w-full" data-testid={`button-open-album-photo-${photo.id}`}><img src={photo.thumbnailUrl} alt={photo.filename} className="w-full object-cover transition-transform duration-500 group-hover:scale-105" /></button><button onClick={() => { if (window.confirm('Remove this moment from the album?')) remove.mutate({ albumId: id, photoId: photo.id }, { onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListPhotosQueryKey({ albumId: id, limit: 100 }) }); queryClient.invalidateQueries({ queryKey: getListAlbumsQueryKey() }); } }); }} className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-primary/60 text-primary-foreground opacity-0 backdrop-blur group-hover:opacity-100" data-testid={`button-remove-album-photo-${photo.id}`}><X size={14} /></button></article>)}</div>}
     {viewer && <Viewer photo={viewer} onClose={() => setViewer(null)} onFavorite={(photo) => toggle.mutate({ photoId: photo.id, data: { isFavorite: !photo.isFavorite } }, { onSuccess: (updated) => { setViewer(updated); queryClient.invalidateQueries({ queryKey: getListPhotosQueryKey({ albumId: id, limit: 100 }) }); } })} onPrevious={() => { const index = albumPhotos.findIndex((item) => item.id === viewer.id); setViewer(albumPhotos[(index - 1 + albumPhotos.length) % albumPhotos.length]); }} onNext={() => { const index = albumPhotos.findIndex((item) => item.id === viewer.id); setViewer(albumPhotos[(index + 1) % albumPhotos.length]); }} isPending={toggle.isPending} />}
  </section>;
}

function Places() {
  const placesQuery = useListPlaces();
  const places = placesQuery.data || [];
  return <section className="px-5 py-9 md:px-10 md:py-12"><PageIntro eyebrow="Coordinates & memories" title="Places" description="A mapless, human view of where your camera has wandered." />{placesQuery.isLoading ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[1, 2, 3].map((i) => <div key={i} className="h-52 animate-pulse rounded-3xl bg-muted" />)}</div> : placesQuery.isError ? <ErrorState retry={() => placesQuery.refetch()} /> : places.length === 0 ? <EmptyState icon={MapPin} title="No places yet" description="Moments with GPS coordinates will gather here as your archive comes to life." /> : <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{places.map((place, i) => <article key={place.id} className={cn('group animate-drift overflow-hidden rounded-3xl border border-border bg-card', `stagger-${Math.min(i + 1, 4)}`)} data-testid={`card-place-${place.id}`}><div className="relative aspect-[1.55] overflow-hidden bg-secondary/20">{place.coverUrl ? <img src={place.coverUrl} alt={place.label} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" /> : <div className="flex h-full items-center justify-center text-accent/50"><MapPin size={38} strokeWidth={1.2} /></div>}<span className="absolute left-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-primary/65 text-secondary backdrop-blur"><MapPin size={16} /></span></div><div className="p-5"><h2 className="font-serif text-2xl italic text-primary" data-testid={`text-place-label-${place.id}`}>{place.label}</h2><div className="mt-2 flex justify-between text-xs text-muted-foreground"><span>{place.photoCount} {place.photoCount === 1 ? 'moment' : 'moments'}</span><span className="font-mono text-[10px]">{place.latitude.toFixed(2)}°, {place.longitude.toFixed(2)}°</span></div></div></article>)}</div>}</section>;
}

function ImportPage() {
  const importsQuery = useListImports();
  const [path, setPath] = useState('');
  const [sourceType, setSourceType] = useState<'GOOGLE_TAKEOUT' | 'LOCAL_FOLDER' | 'EXTERNAL_HDD'>('GOOGLE_TAKEOUT');
  const [folderAlbums, setFolderAlbums] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const start = useStartImport();
  const confirm = useConfirmImport();
  const activeQuery = useGetImport(activeId || '', { query: { enabled: !!activeId, refetchInterval: activeId ? 1800 : false, queryKey: getGetImportQueryKey(activeId || '') } });
  const pause = usePauseImport();
  const resume = useResumeImport();
  const cancel = useCancelImport();
  const retry = useRetryImport();
  const jobs = importsQuery.data || [];
  const active = activeQuery.data || jobs[0];
  const startImport = (e: FormEvent) => { e.preventDefault(); if (!path.trim()) return; start.mutate({ data: { sourcePath: path.trim(), sourceType, importFolderStructureAsAlbums: folderAlbums } }, { onSuccess: (job) => { setActiveId(job.id); setPath(''); queryClient.invalidateQueries({ queryKey: getListImportsQueryKey() }); } }); };
  const confirmImport = () => { if (!active) return; confirm.mutate({ importId: active.id }, { onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListImportsQueryKey() }); queryClient.invalidateQueries({ queryKey: getGetImportQueryKey(active.id) }); queryClient.invalidateQueries({ queryKey: getGetStatsQueryKey() }); queryClient.invalidateQueries({ queryKey: getListPhotosQueryKey() }); } }); };
  const action = (kind: 'pause' | 'resume' | 'cancel') => { if (!active) return; const mutation = kind === 'pause' ? pause : kind === 'resume' ? resume : cancel; mutation.mutate({ importId: active.id }, { onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListImportsQueryKey() }); queryClient.invalidateQueries({ queryKey: getGetImportQueryKey(active.id) }); } }); };
  const retryFailed = () => { if (!active) return; retry.mutate({ importId: active.id }, { onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListImportsQueryKey() }); queryClient.invalidateQueries({ queryKey: getGetImportQueryKey(active.id) }); } }); };
  return <section className="px-5 py-9 md:px-10 md:py-12">
     <PageIntro eyebrow="Bring it home" title="Import archive" description="Scan a Takeout export, a local folder, or an external drive. Originals are copied into your local library, never uploaded." action={<div className="flex flex-wrap gap-2">{active?.status === 'ready' && <button onClick={confirmImport} disabled={confirm.isPending} className="inline-flex items-center justify-center gap-2 rounded-xl bg-secondary px-4 py-3 text-xs font-bold text-primary disabled:opacity-40" data-testid="button-confirm-import">{confirm.isPending ? <LoaderCircle size={15} className="animate-spin" /> : <Check size={15} />}Confirm import</button>}{active && active.failedFiles > 0 && ['completed', 'failed'].includes(active.status ?? '') && <button onClick={retryFailed} disabled={retry.isPending} className="inline-flex items-center justify-center gap-2 rounded-xl border border-accent/30 px-4 py-3 text-xs font-bold text-accent disabled:opacity-40" data-testid="button-retry-import">{retry.isPending ? <LoaderCircle size={15} className="animate-spin" /> : <CircleAlert size={15} />}Retry {active.failedFiles} failed</button>}</div>} />
    <div className="grid gap-6 lg:grid-cols-[1.35fr_.65fr]">
      <div className="rounded-3xl border border-border bg-card p-6 shadow-sm md:p-8">
        <div className="flex items-start gap-4"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-secondary/30 text-accent"><Upload size={21} /></span><div><h2 className="font-serif text-2xl italic text-primary">Start a local import</h2><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Choose where the files live, then review the scan before anything is copied.</p></div></div>
        <form onSubmit={startImport} className="mt-7">
          <div className="grid gap-3 sm:grid-cols-3">
            {([['GOOGLE_TAKEOUT', 'Google Takeout'], ['LOCAL_FOLDER', 'Local folder'], ['EXTERNAL_HDD', 'External drive']] as const).map(([value, label]) => <button type="button" key={value} onClick={() => setSourceType(value)} className={cn('rounded-xl border px-3 py-3 text-left text-xs font-bold transition-colors', sourceType === value ? 'border-secondary bg-secondary/15 text-primary' : 'border-border text-muted-foreground hover:bg-muted')} data-testid={`button-source-${value.toLowerCase()}`}><span className={cn('mb-2 block h-2 w-2 rounded-full', sourceType === value ? 'bg-accent' : 'bg-border')} />{label}</button>)}
          </div>
          <label className="mt-6 block font-mono text-[10px] uppercase tracking-[.18em] text-muted-foreground">Source folder<input value={path} onChange={(e) => setPath(e.target.value)} placeholder={sourceType === 'GOOGLE_TAKEOUT' ? '/Volumes/Archive/Takeout/Google Photos' : '/Volumes/Photos'} className="mt-2 h-12 w-full rounded-xl border border-border bg-background px-4 text-sm outline-none focus:ring-2 focus:ring-secondary" data-testid="input-import-path" /></label>
          <label className="mt-4 flex cursor-pointer items-center gap-3 rounded-xl border border-border bg-background px-4 py-3 text-xs text-primary"><input type="checkbox" checked={folderAlbums} onChange={(e) => setFolderAlbums(e.target.checked)} className="h-4 w-4 accent-[hsl(var(--accent))]" data-testid="input-import-folder-albums" /><span><span className="block font-bold">Turn folders into albums</span><span className="mt-0.5 block text-muted-foreground">Keep the folder structure as curated chapters.</span></span></label>
          <button disabled={start.isPending || !path.trim()} className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-xs font-bold text-primary-foreground transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-40" data-testid="button-start-import">{start.isPending ? <><LoaderCircle size={15} className="animate-spin" />Scanning folder…</> : <><Import size={15} />Scan for review</>}</button>
        </form>
        <div className="mt-7 grid gap-3 border-t border-border pt-6 sm:grid-cols-3"><div><p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Step 01</p><p className="mt-1 text-xs font-semibold">Scan folder</p></div><div><p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Step 02</p><p className="mt-1 text-xs font-semibold">Review duplicates</p></div><div><p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Step 03</p><p className="mt-1 text-xs font-semibold">Keep originals local</p></div></div>
      </div>
      <div className="rounded-3xl bg-primary p-6 text-primary-foreground md:p-8"><Sparkles className="text-secondary" size={20} /><h2 className="mt-5 font-serif text-3xl italic">Nothing gets sent away.</h2><p className="mt-3 text-sm leading-relaxed text-primary-foreground/60">My Photos is designed for a home server, a quiet room, and a library that belongs only to you.</p><div className="mt-8 flex items-center gap-3 border-t border-primary-foreground/15 pt-5"><HardDrive size={17} className="text-secondary" /><span className="font-mono text-[10px] uppercase tracking-wider text-primary-foreground/50">Self-hosted by design</span></div></div>
    </div>
     {active && <div className="mt-6 rounded-3xl border border-border bg-card p-6 md:p-8"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start"><div><div className="flex items-center gap-2"><span className={cn('h-2 w-2 rounded-full', active.status === 'completed' ? 'bg-chart-3' : active.status === 'failed' ? 'bg-destructive' : active.status === 'paused' ? 'bg-accent' : 'animate-pulse bg-secondary')} /><span className="font-mono text-[10px] uppercase tracking-[.2em] text-muted-foreground">Latest import · {active.status}</span></div><h2 className="mt-3 max-w-xl truncate font-serif text-2xl italic text-primary">{active.sourcePath}</h2></div><div className="flex gap-2">{active.status === 'paused' ? <button onClick={() => action('resume')} className="flex items-center gap-2 rounded-xl bg-secondary px-3 py-2 text-xs font-bold text-primary" data-testid="button-resume-import"><Play size={14} />Resume</button> : ['scanning', 'importing'].includes(active.status ?? '') && <button onClick={() => action('pause')} className="flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-xs font-bold text-primary" data-testid="button-pause-import"><Pause size={14} />Pause</button>}{['scanning', 'importing', 'paused'].includes(active.status ?? '') && <button onClick={() => action('cancel')} className="rounded-xl border border-border px-3 py-2 text-xs font-bold text-muted-foreground hover:text-destructive" data-testid="button-cancel-import">Cancel</button>}</div></div><div className="mt-7"><div className="flex justify-between font-mono text-[10px] text-muted-foreground"><span>{active.currentFile || (active.status === 'completed' ? 'Import complete' : 'Waiting for the next file…')}</span><span>{pct(active)}%</span></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-secondary transition-[width] duration-500" style={{ width: `${pct(active)}%` }} /></div><div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4"><Stat label="Processed" value={active.processedFiles} /><Stat label="Imported" value={active.successfulFiles} /><Stat label="Duplicates" value={active.duplicateFiles} /><Stat label="Failed" value={active.failedFiles} /></div></div>{active.errors?.length > 0 && <details className="mt-7 rounded-xl border border-accent/20 bg-accent/5 p-4"><summary className="cursor-pointer text-xs font-bold text-accent" data-testid="button-toggle-import-errors">View {active.errors.length} error{active.errors.length === 1 ? '' : 's'}</summary><ul className="mt-3 space-y-2 font-mono text-[10px] leading-relaxed text-muted-foreground">{active.errors.map((error, i) => <li key={i} data-testid={`text-import-error-${i}`}>{error}</li>)}</ul></details>}</div>}
    <div className="mt-8"><div className="mb-4 flex items-center justify-between"><h2 className="font-mono text-[10px] uppercase tracking-[.2em] text-muted-foreground">Import history</h2><span className="font-mono text-[10px] text-muted-foreground/60">{jobs.length} jobs</span></div>{jobs.length === 0 ? <p className="rounded-2xl border border-dashed border-border px-5 py-8 text-center text-xs text-muted-foreground">No imports recorded yet.</p> : <div className="divide-y divide-border rounded-2xl border border-border bg-card">{jobs.map((job) => <button key={job.id} onClick={() => setActiveId(job.id)} className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left hover:bg-muted/40" data-testid={`button-select-import-${job.id}`}><span className="min-w-0"><span className="block truncate text-xs font-semibold text-primary">{job.sourcePath}</span><span className="mt-1 block font-mono text-[10px] text-muted-foreground">{fmtDate(job.startedAt, 'short')} · {job.processedFiles.toLocaleString()} files</span></span><span className="shrink-0 font-mono text-[10px] uppercase text-muted-foreground">{job.status}</span></button>)}</div>}</div>
  </section>;
}

type UploadItem = { file: File; status: 'queued' | 'uploading' | 'accepted' | 'failed'; error?: string };

function UploadPage() {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const addFiles = (files: FileList | File[]) => {
    const next = Array.from(files).filter((file) => file.size > 0);
    setItems((current) => [...current, ...next.map((file) => ({ file, status: 'queued' as const }))]);
  };
  const startUploads = async () => {
    const queued = items.map((item, index) => ({ item, index })).filter(({ item }) => item.status === 'queued');
    for (const { item, index } of queued) {
      setItems((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, status: 'uploading' } : entry));
      try {
        await uploadBrowserFile(item.file, {
          headers: {
            'Content-Type': item.file.type || 'application/octet-stream',
            'X-File-Name': encodeURIComponent(item.file.name),
          },
        });
        setItems((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, status: 'accepted' } : entry));
      } catch (error) {
        setItems((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, status: 'failed', error: String(error) } : entry));
      }
    }
  };
  return <section className="px-5 py-9 md:px-10 md:py-12">
    <PageIntro eyebrow="Bring a moment" title="Upload" description="Add photographs and videos from this device. Each file is streamed into the same local import engine and deduplicated against the whole library." />
    <div
      className={cn('rounded-3xl border-2 border-dashed bg-card p-8 text-center transition-colors md:p-14', dragging ? 'border-secondary bg-secondary/10' : 'border-border')}
      onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => { event.preventDefault(); setDragging(false); addFiles(event.dataTransfer.files); }}
      data-testid="dropzone-browser-upload"
    >
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-secondary/25 text-accent"><Upload size={25} /></span>
      <h2 className="mt-5 font-serif text-3xl italic text-primary">Drop files here</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">Or browse your device. Originals stay on this server; source files are never changed.</p>
      <label className="mt-6 inline-flex cursor-pointer items-center gap-2 rounded-xl bg-primary px-4 py-3 text-xs font-bold text-primary-foreground">
        <input type="file" multiple accept="image/*,video/*" className="sr-only" onChange={(event) => { if (event.target.files) addFiles(event.target.files); event.currentTarget.value = ''; }} data-testid="input-browser-upload" />
        Choose files
      </label>
    </div>
    {items.length > 0 && <div className="mt-6 rounded-3xl border border-border bg-card p-5 md:p-7">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div><h2 className="font-serif text-2xl italic text-primary">{items.length} file{items.length === 1 ? '' : 's'} ready</h2><p className="mt-1 text-xs text-muted-foreground">Uploads are processed in order and continue in the background.</p></div><button onClick={startUploads} disabled={!items.some((item) => item.status === 'queued')} className="rounded-xl bg-secondary px-4 py-3 text-xs font-bold text-primary disabled:opacity-40" data-testid="button-start-browser-upload">Start upload</button></div>
      <ul className="mt-5 divide-y divide-border">{items.map((item, index) => <li key={`${item.file.name}-${index}`} className="flex items-center justify-between gap-4 py-3 text-xs"><span className="min-w-0 truncate font-semibold text-primary">{item.file.name}<span className="ml-2 font-mono text-[10px] text-muted-foreground">{fmtBytes(item.file.size)}</span></span><span className={cn('shrink-0 font-mono text-[10px] uppercase', item.status === 'failed' ? 'text-destructive' : item.status === 'accepted' ? 'text-chart-3' : 'text-muted-foreground')}>{item.status}{item.error ? ` · ${item.error}` : ''}</span></li>)}</ul>
    </div>}
  </section>;
}

function Stat({ label, value }: { label: string; value: number | string }) { return <div><p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p><p className="mt-1 text-lg font-bold text-primary" data-testid={`text-stat-${label.toLowerCase()}`}>{value}</p></div>; }

function SettingsPage() {
  const statsQuery = useGetStats();
  const sessionQuery = useGetSession();
  const health = useHealthCheck();
  const stats = statsQuery.data;
  const [autoOrganize, setAutoOrganize] = useState(true);
  const [rememberView, setRememberView] = useState(true);
  return <section className="px-5 py-9 md:px-10 md:py-12"><PageIntro eyebrow="The quiet details" title="Settings" description="A few preferences for how your private library feels and behaves." /><div className="grid gap-6 lg:grid-cols-[1fr_1fr]"><div className="rounded-3xl border border-border bg-card p-6 md:p-8"><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary/30 text-accent"><Settings size={18} /></span><h2 className="font-serif text-2xl italic text-primary">Library preferences</h2></div><SettingRow label="Auto-organize imports" description="Group new moments by year after scanning." checked={autoOrganize} onChange={setAutoOrganize} testId="switch-auto-organize" /><SettingRow label="Remember last view" description="Open the library where you left it." checked={rememberView} onChange={setRememberView} testId="switch-remember-view" /><div className="mt-7 border-t border-border pt-6"><p className="font-mono text-[10px] uppercase tracking-[.18em] text-muted-foreground">Signed in as</p><p className="mt-2 text-sm font-semibold text-primary" data-testid="text-settings-username">{sessionQuery.data?.username || 'local owner'}</p><div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"><span className={cn('h-2 w-2 rounded-full', health.data?.status === 'ok' ? 'bg-chart-3' : 'bg-secondary')} />Library service {health.data?.status === 'ok' ? 'healthy' : 'connected'}</div></div></div><div className="rounded-3xl border border-border bg-card p-6 md:p-8"><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/10 text-accent"><HardDrive size={18} /></span><h2 className="font-serif text-2xl italic text-primary">Library at a glance</h2></div>{statsQuery.isLoading ? <div className="mt-7 grid grid-cols-2 gap-x-6 gap-y-7">{[1, 2, 3, 4].map((i) => <div key={i} className="h-12 animate-pulse rounded bg-muted" />)}</div> : statsQuery.isError ? <div className="mt-7"><ErrorState retry={() => statsQuery.refetch()} /></div> : <div className="mt-7 grid grid-cols-2 gap-x-6 gap-y-7"><Stat label="Photographs" value={(stats?.totalPhotos || 0).toLocaleString()} /><Stat label="Videos" value={(stats?.totalVideos || 0).toLocaleString()} /><Stat label="Total files" value={(stats?.totalFiles || 0).toLocaleString()} /><Stat label="Favorites" value={(stats?.favoriteCount || 0).toLocaleString()} /><Stat label="Storage used" value={fmtBytes(stats?.totalStorageBytes)} /><Stat label="Duplicates skipped" value={(stats?.duplicateFiles || 0).toLocaleString()} /></div>}<div className="mt-8 border-t border-border pt-5"><p className="text-xs text-muted-foreground">Latest capture</p><p className="mt-1 font-serif text-lg italic text-primary" data-testid="text-latest-capture">{fmtDate(stats?.latestCaptureDate, 'short')}</p></div></div></div><div className="mt-6 rounded-2xl border border-secondary/30 bg-secondary/10 p-5"><div className="flex gap-3"><KeyRound className="mt-0.5 shrink-0 text-accent" size={17} /><div><h3 className="text-sm font-bold text-primary">Local password protection</h3><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Your account and library live on the same private server. There is no cloud account to sync or recover.</p></div></div></div></section>;
}

function SettingRow({ label, description, checked, onChange, testId }: { label: string; description: string; checked: boolean; onChange: (value: boolean) => void; testId: string }) { return <label className="mt-7 flex cursor-pointer items-start justify-between gap-4"><span><span className="block text-sm font-bold text-primary">{label}</span><span className="mt-1 block max-w-sm text-xs leading-relaxed text-muted-foreground">{description}</span></span><button type="button" onClick={() => onChange(!checked)} className={cn('relative mt-1 h-6 w-11 shrink-0 rounded-full transition-colors', checked ? 'bg-secondary' : 'bg-muted')} data-testid={testId} aria-pressed={checked}><span className={cn('absolute top-1 h-4 w-4 rounded-full bg-primary transition-transform', checked ? 'translate-x-6' : 'translate-x-1')} /></button></label>; }

function Login() {
  const [, setLocation] = useLocation();
  const login = useLogin();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const submit = (e: FormEvent) => { e.preventDefault(); setError(''); login.mutate({ data: { username, password } }, { onSuccess: () => { queryClient.invalidateQueries({ queryKey: getGetSessionQueryKey() }); setLocation('/'); }, onError: () => setError('That password did not match this library.') }); };
  return <main className="grain flex min-h-[100dvh] items-center justify-center bg-primary px-5 py-10 text-primary-foreground"><div className="grid w-full max-w-4xl overflow-hidden rounded-[28px] border border-primary-foreground/10 bg-primary shadow-2xl md:grid-cols-[1.05fr_.95fr]"><div className="relative hidden min-h-[600px] overflow-hidden bg-secondary md:block"><div className="absolute inset-0 opacity-50" style={{ background: 'radial-gradient(circle at 25% 20%, hsl(13 62% 58% / .75), transparent 38%), radial-gradient(circle at 80% 85%, hsl(36 88% 62% / .5), transparent 42%)' }} /><div className="relative flex h-full flex-col justify-between p-10 text-primary"><div><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/90 text-secondary"><Camera size={21} /></span><p className="mt-8 font-mono text-[10px] uppercase tracking-[.22em] text-primary/55">A private visual journal</p></div><div><h1 className="max-w-sm font-serif text-5xl italic leading-[.98]">Come back to your moments.</h1><p className="mt-6 max-w-xs text-sm leading-relaxed text-primary/65">Your photographs, held close and arranged with care.</p></div><div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-primary/50"><ShieldCheck size={14} />Stored on your server</div></div></div><div className="flex min-h-[560px] flex-col justify-center bg-background p-7 text-foreground md:p-12"><div className="md:hidden"><Logo /></div><p className="mt-8 font-mono text-[10px] uppercase tracking-[.22em] text-accent md:mt-0">Welcome home</p><h2 className="mt-3 font-serif text-4xl italic text-primary">Open your library.</h2><p className="mt-3 text-sm leading-relaxed text-muted-foreground">Sign in to continue to your local archive.</p><form onSubmit={submit} className="mt-9 space-y-5"><label className="block text-xs font-bold text-primary">Username<input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" className="mt-2 h-12 w-full rounded-xl border border-border bg-card px-4 text-sm outline-none focus:ring-2 focus:ring-secondary" data-testid="input-login-username" /></label><label className="block text-xs font-bold text-primary">Password<input value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="current-password" className="mt-2 h-12 w-full rounded-xl border border-border bg-card px-4 text-sm outline-none focus:ring-2 focus:ring-secondary" data-testid="input-login-password" /></label>{error && <div className="flex items-center gap-2 rounded-xl bg-accent/10 px-3 py-3 text-xs text-accent" data-testid="status-login-error"><CircleAlert size={15} />{error}</div>}<button disabled={login.isPending || !username || !password} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-xs font-bold text-primary-foreground transition-transform hover:-translate-y-0.5 disabled:opacity-40" data-testid="button-login">{login.isPending ? <LoaderCircle size={15} className="animate-spin" /> : <ShieldCheck size={15} />}Enter library</button></form><p className="mt-8 text-center font-mono text-[9px] uppercase tracking-widest text-muted-foreground/60">No cloud account · no tracking · no upload</p></div></div></main>;
}

function Router() {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}><Switch><Route path="/login" component={Login} /><Route path="/" component={() => <Shell><Timeline /></Shell>} /><Route path="/favorites" component={() => <Shell><Timeline favoritesOnly /></Shell>} /><Route path="/albums" component={() => <Shell><Albums /></Shell>} /><Route path="/albums/:id" component={() => <Shell><AlbumDetail /></Shell>} /><Route path="/places" component={() => <Shell><Places /></Shell>} /><Route path="/archive" component={() => <Shell><Timeline archivedOnly /></Shell>} /><Route path="/trash" component={() => <Shell><TrashPage /></Shell>} /><Route path="/import" component={() => <Shell><ImportPage /></Shell>} /><Route path="/upload" component={() => <Shell><UploadPage /></Shell>} /><Route path="/settings" component={() => <Shell><SettingsPage /></Shell>} /><Route component={NotFound} /></Switch></ErrorBoundary>;
}

function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;