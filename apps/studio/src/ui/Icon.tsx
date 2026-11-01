import {
  ArrowLeft, Atom, Bot, Box, Bug, Check, ChevronDown, ChevronRight, Circle, CircleAlert, Clapperboard, Code, Coins, Copy, CopyPlus, Cpu, Crosshair,
  Cylinder, Download, EllipsisVertical, ExternalLink, Eye, EyeOff, FileCode, Flag, Flashlight, Folder, FolderOpen, Footprints, Gamepad2, Gauge, Glasses,
  Globe, Grid3x3, Heart, House, Image, Info, Layers, Library, Lightbulb, LoaderCircle, LogOut, Magnet, Maximize2, Menu, Minimize2, Monitor, Moon, Move,
  Move3d, Music, Package, PanelTop, Pause, Pencil, Play, Plus, Puzzle, RectangleHorizontal, Redo2, Rocket, Rotate3d, RotateCw, Save, Scale3d, Search, Send,
  Settings, Shapes, Share2, SlidersHorizontal, Smartphone, Sparkles, Square, StepForward, Sun, SunMedium, Swords, Target, Terminal, Timer, Trash,
  TriangleAlert, Type, Undo2, Upload, User, Users, Video, Volume2, WandSparkles, Waves, Wifi, Workflow, X, Zap, type LucideIcon,
} from 'lucide-react';

/** Explicit registry (tree-shaken) so data can reference icons by name. */
const ICONS: Record<string, LucideIcon> = {
  ArrowLeft, Atom, Bot, Box, Bug, Check, ChevronDown, ChevronRight, Circle, CircleAlert, Clapperboard, Code, Coins, Copy, CopyPlus, Cpu, Crosshair,
  Cylinder, Download, EllipsisVertical, ExternalLink, Eye, EyeOff, FileCode, Flag, Flashlight, Folder, FolderOpen, Footprints, Gamepad2, Gauge, Glasses,
  Globe, Grid3x3, Heart, House, Image, Info, Layers, Library, Lightbulb, LoaderCircle, LogOut, Magnet, Maximize2, Menu, Minimize2, Monitor, Moon, Move,
  Move3d, Music, Package, PanelTop, Pause, Pencil, Play, Plus, Puzzle, RectangleHorizontal, Redo2, Rocket, Rotate3d, RotateCw, Save, Scale3d, Search, Send,
  Settings, Shapes, Share2, SlidersHorizontal, Smartphone, Sparkles, Square, StepForward, Sun, SunMedium, Swords, Target, Terminal, Timer, Trash,
  TriangleAlert, Type, Undo2, Upload, User, Users, Video, Volume2, WandSparkles, Waves, Wifi, Workflow, X, Zap,
};

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 16, className, style }: { name: string; size?: number; className?: string; style?: React.CSSProperties }) {
  const C = ICONS[name] ?? Square;
  return <C size={size} className={className} style={style} strokeWidth={2} aria-hidden />;
}
