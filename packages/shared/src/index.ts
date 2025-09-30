
export type Asset = {
  id: string;
  filename: string;
  mime: string;
  size: number;
  sha256?: string | null;
  status: 'draft'|'uploading'|'ready'|'corrupt';
  version: number;
  createdAt: string;
  updatedAt: string;
};
