export interface IApiResponseDto<T = unknown> {
  message?: string;
  data?: T;
}

export class ApiResponseDto<T = unknown> implements IApiResponseDto {
  public message?: string = undefined;
  public data?: T = undefined;

  constructor(value: IApiResponseDto<T>) {
    this.message = value.message;
    this.data = value.data;
  }
}
