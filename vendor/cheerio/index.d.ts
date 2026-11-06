export interface CheerioElement {
  type: "tag" | "text" | "root";
  name: string;
  attribs: Record<string, string>;
  children: CheerioElement[];
  parent: CheerioElement | null;
  data?: string;
}

export interface Cheerio<T = CheerioElement> extends Iterable<T> {
  readonly length: number;
  [index: number]: T;
  find(selector: string): Cheerio<CheerioElement>;
  filter(
    predicate: string | ((this: T, index: number, element: T) => boolean)
  ): Cheerio<T>;
  not(
    predicate: string | ((this: T, index: number, element: T) => boolean)
  ): Cheerio<T>;
  children(selector?: string): Cheerio<CheerioElement>;
  parent(selector?: string): Cheerio<CheerioElement>;
  parents(selector?: string): Cheerio<CheerioElement>;
  closest(selector: string): Cheerio<CheerioElement>;
  next(selector?: string): Cheerio<CheerioElement>;
  prev(selector?: string): Cheerio<CheerioElement>;
  siblings(selector?: string): Cheerio<CheerioElement>;
  first(): Cheerio<T>;
  last(): Cheerio<T>;
  eq(index: number): Cheerio<T>;
  get(): T[];
  get(index: number): T | undefined;
  toArray(): T[];
  each(callback: (this: T, index: number, element: T) => void | boolean): this;
  map<U>(callback: (this: T, index: number, element: T) => U): Cheerio<U>;
  text(): string;
  html(): string | null;
  attr(name: string): string | undefined;
  attr(name: string, value: string): this;
  data(name: string): string | undefined;
  val(): string | undefined;
  hasClass(className: string): boolean;
  is(selector: string): boolean;
  clone(): Cheerio<T>;
  remove(): this;
}

export interface CheerioAPI {
  (selector: string | CheerioElement | CheerioElement[] | Cheerio<any>, context?: string | CheerioElement | Cheerio<any>): Cheerio<CheerioElement>;
  load(html: string): CheerioAPI;
  html(element?: CheerioElement | Cheerio<any>): string;
  text(elements?: CheerioElement[] | Cheerio<any>): string;
  root(): Cheerio<CheerioElement>;
}

export declare function load(html: string, options?: Record<string, unknown>): CheerioAPI;
declare const cheerio: {
  load: typeof load;
};
export default cheerio;
