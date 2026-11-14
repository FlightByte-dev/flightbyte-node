import type { Country } from '../models.js';
import { required, type RequestOptions, type Transport } from '../request.js';

/** Options for the country endpoints. */
export interface CountryOptions extends RequestOptions {
  /** The language of the names, for example `tr`. The API's default is `en`. */
  lang?: string;
}

/** Country names, emoji and flags. Reach it as `client.countries`. */
export class Countries {
  /** @internal */
  constructor(private readonly transport: Transport) {}

  /** Every country, sorted by name. */
  async list(options: CountryOptions = {}): Promise<Country[]> {
    const { lang, ...request } = options;
    const result = await this.transport.send<{ count: number; data: Country[] }>('GET', ['countries'], {
      ...request,
      query: { lang },
    });
    return result.data;
  }

  /** One country by its ISO 3166-1 alpha-2 code. */
  async get(code: string, options: CountryOptions = {}): Promise<Country> {
    const { lang, ...request } = options;
    return this.transport.send<Country>('GET', ['countries', required('code', code)], {
      ...request,
      query: { lang },
    });
  }

  /**
   * The URL of a country's SVG flag: 4:3, or 1:1 with `square`. Flags need no
   * API key, so the URL can go straight into an `<img>`.
   */
  flagUrl(code: string, options: { square?: boolean } = {}): string {
    return this.transport.url(['flags', `${required('code', code).toLowerCase()}.svg`], {
      shape: options.square ? '1x1' : undefined,
    });
  }
}
