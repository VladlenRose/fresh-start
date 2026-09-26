import type { Models } from "appwrite";

import {
  BUCKET_ID,
  DB_ID,
  ID,
  Permission,
  Query,
  Role,
  TABLES,
  storage,
  tables,
} from "@/lib/appwrite";

export type ProductStatus = "Активен" | "На модерации" | "Завершён";
export type NegotiationStage = "Торг идёт" | "Согласовано" | "Документы готовы";
export type DocStatus = "Подписан" | "Ожидает подписи" | "Черновик";

export type Product = Models.Row & {
  ownerId: string;
  title: string;
  description?: string;
  supplier?: string;
  category?: string;
  price: number;
  unit?: string;
  rating: number;
  imageId?: string | null;
  status: ProductStatus;
};

export type Profile = Models.Row & {
  userId: string;
  name?: string;
  company?: string;
  email?: string;
  phone?: string;
  inn?: string;
};

export type Thread = Models.Row & {
  buyerId: string;
  sellerId?: string;
  productId?: string;
  company?: string;
  stage: NegotiationStage;
  preview?: string;
  lastAt?: string;
};

export type Message = Models.Row & {
  threadId: string;
  author: "me" | "agent";
  text?: string;
  offerPrice?: string;
  offerTerm?: string;
  offerConditions?: string;
  createdAt?: string;
};

export type DocumentRow = Models.Row & {
  ownerId: string;
  threadId?: string;
  title: string;
  counterparty?: string;
  status: DocStatus;
  body?: string;
  createdAt?: string;
};

const ownerPerms = (userId: string) => [
  Permission.read(Role.any()),
  Permission.update(Role.user(userId)),
  Permission.delete(Role.user(userId)),
];

export type ProductInput = {
  title: string;
  description?: string;
  supplier?: string;
  category?: string;
  price: number;
  unit?: string;
  rating: number;
  imageId?: string | null;
  status: ProductStatus;
};

export type ProfileInput = {
  name?: string;
  company?: string;
  email?: string;
  phone?: string;
  inn?: string;
};

export type ThreadInput = {
  sellerId?: string;
  productId?: string;
  company?: string;
  stage: NegotiationStage;
  preview?: string;
  lastAt?: string;
};

export type MessageInput = {
  threadId: string;
  author: "me" | "agent";
  text?: string;
  offerPrice?: string;
  offerTerm?: string;
  offerConditions?: string;
  createdAt?: string;
};

export type DocumentInput = {
  threadId?: string;
  title: string;
  counterparty?: string;
  status: DocStatus;
  body?: string;
  createdAt?: string;
};

/* ---------------- products ---------------- */

export async function listProducts() {
  const res = await tables.listRows<Product>({
    databaseId: DB_ID,
    tableId: TABLES.products,
    queries: [Query.orderDesc("$createdAt"), Query.limit(100)],
  });
  return res.rows;
}

export async function listMyProducts(userId: string) {
  const res = await tables.listRows<Product>({
    databaseId: DB_ID,
    tableId: TABLES.products,
    queries: [Query.equal("ownerId", userId), Query.orderDesc("$createdAt"), Query.limit(100)],
  });
  return res.rows;
}

export async function createProduct(
  userId: string,
  data: ProductInput,
) {
  return tables.createRow<Product>({
    databaseId: DB_ID,
    tableId: TABLES.products,
    rowId: ID.unique(),
    data: { ...data, ownerId: userId },
    permissions: ownerPerms(userId),
  });
}

export async function updateProduct(id: string, data: Partial<ProductInput>) {
  return tables.updateRow<Product>({
    databaseId: DB_ID,
    tableId: TABLES.products,
    rowId: id,
    data,
  });
}

export async function deleteProduct(id: string) {
  return tables.deleteRow({ databaseId: DB_ID, tableId: TABLES.products, rowId: id });
}

export async function uploadProductImage(file: File) {
  const res = await storage.createFile({
    bucketId: BUCKET_ID,
    fileId: ID.unique(),
    file,
    permissions: [Permission.read(Role.any())],
  });
  return res.$id;
}

/* ---------------- profile ---------------- */

export async function getProfile(userId: string) {
  const res = await tables.listRows<Profile>({
    databaseId: DB_ID,
    tableId: TABLES.profiles,
    queries: [Query.equal("userId", userId), Query.limit(1)],
  });
  return res.rows[0] ?? null;
}

export async function saveProfile(userId: string, data: ProfileInput) {
  const existing = await getProfile(userId);
  if (existing) {
    return tables.updateRow<Profile>({
      databaseId: DB_ID,
      tableId: TABLES.profiles,
      rowId: existing.$id,
      data,
    });
  }
  return tables.createRow<Profile>({
    databaseId: DB_ID,
    tableId: TABLES.profiles,
    rowId: ID.unique(),
    data: { ...data, userId },
    permissions: ownerPerms(userId),
  });
}

/* ---------------- threads & messages ---------------- */

export async function listThreads(userId: string) {
  const res = await tables.listRows<Thread>({
    databaseId: DB_ID,
    tableId: TABLES.threads,
    queries: [Query.equal("buyerId", userId), Query.orderDesc("$createdAt"), Query.limit(100)],
  });
  return res.rows;
}

export async function createThread(
  userId: string,
  data: ThreadInput,
) {
  return tables.createRow<Thread>({
    databaseId: DB_ID,
    tableId: TABLES.threads,
    rowId: ID.unique(),
    data: { ...data, buyerId: userId },
    permissions: ownerPerms(userId),
  });
}

export async function updateThread(id: string, data: Partial<ThreadInput>) {
  return tables.updateRow<Thread>({
    databaseId: DB_ID,
    tableId: TABLES.threads,
    rowId: id,
    data,
  });
}

export async function listMessages(threadId: string) {
  const res = await tables.listRows<Message>({
    databaseId: DB_ID,
    tableId: TABLES.messages,
    queries: [Query.equal("threadId", threadId), Query.orderAsc("$createdAt"), Query.limit(200)],
  });
  return res.rows;
}

export async function createMessage(
  userId: string,
  data: MessageInput,
) {
  return tables.createRow<Message>({
    databaseId: DB_ID,
    tableId: TABLES.messages,
    rowId: ID.unique(),
    data: { ...data, createdAt: data.createdAt ?? new Date().toISOString() },
    permissions: ownerPerms(userId),
  });
}

/* ---------------- documents ---------------- */

export async function listDocuments(userId: string) {
  const res = await tables.listRows<DocumentRow>({
    databaseId: DB_ID,
    tableId: TABLES.documents,
    queries: [Query.equal("ownerId", userId), Query.orderDesc("$createdAt"), Query.limit(100)],
  });
  return res.rows;
}

export async function createDocument(
  userId: string,
  data: DocumentInput,
) {
  return tables.createRow<DocumentRow>({
    databaseId: DB_ID,
    tableId: TABLES.documents,
    rowId: ID.unique(),
    data: { ...data, ownerId: userId, createdAt: data.createdAt ?? new Date().toISOString() },
    permissions: ownerPerms(userId),
  });
}

export async function deleteDocument(id: string) {
  return tables.deleteRow({ databaseId: DB_ID, tableId: TABLES.documents, rowId: id });
}
