export type WriterLinkMode = "download" | "share";

export type KVaultWriterSettings = {
	baseUrl: string;
	token: string;
	storage: string;
	folderPath: string;
	linkMode: WriterLinkMode;
};

export const writerStorageKeys = {
	kvault: "firefly:article-writer:kvault",
	draft: "firefly:article-writer:draft",
} as const;

export const defaultKVaultWriterSettings: KVaultWriterSettings = {
	baseUrl: "",
	token: "",
	storage: "telegram",
	folderPath: "blog",
	linkMode: "download",
};
