import { Body, Controller, Get, Inject, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBody, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { CurrentUser as CurrentUserModel } from '../../../../shared/application/current-user';
import { ApiErrorResponses } from '../../../../shared/interface/api-error-responses';
import { CurrentUser } from '../../../../shared/interface/current-user.decorator';
import { Authenticated, RequiresGrant } from '../../../../shared/interface/grant.decorator';
import { CreatePaymentMethod } from '../../application/use-cases/create-payment-method.use-case';
import { ListPaymentMethods } from '../../application/use-cases/list-payment-methods.use-case';
import { UpdatePaymentMethod } from '../../application/use-cases/update-payment-method.use-case';
import { IncludeInactiveQueryDto } from './dto/currencies.dto';
import {
  CreatePaymentMethodDto,
  PaymentMethodResponseDto,
  UpdatePaymentMethodDto,
} from './dto/payment-methods.dto';

type PaymentMethodOutput = Awaited<ReturnType<CreatePaymentMethod['execute']>>;

@ApiTags('settings')
@Controller('payment-methods')
export class PaymentMethodsController {
  constructor(
    @Inject(ListPaymentMethods) private readonly listPaymentMethods: ListPaymentMethods,
    @Inject(CreatePaymentMethod) private readonly createPaymentMethod: CreatePaymentMethod,
    @Inject(UpdatePaymentMethod) private readonly updatePaymentMethod: UpdatePaymentMethod,
  ) {}

  @Authenticated()
  @Get()
  @ApiOperation({
    operationId: 'listPaymentMethods',
    summary: 'Payment methods (active by default; every row with includeInactive)',
  })
  @ApiOkResponse({ description: 'The payment methods, by name', type: [PaymentMethodResponseDto] })
  @ApiErrorResponses('UNAUTHENTICATED', 'VALIDATION', 'INTERNAL')
  async list(
    @CurrentUser() user: CurrentUserModel,
    @Query() query: IncludeInactiveQueryDto,
  ): Promise<PaymentMethodResponseDto[]> {
    const rows = await this.listPaymentMethods.execute(user, query);
    return rows.map(toResponse);
  }

  @RequiresGrant('settings', 'create')
  @Post()
  @ApiOperation({
    operationId: 'createPaymentMethod',
    summary: 'Add a payment method (settings grant)',
  })
  @ApiBody({ type: CreatePaymentMethodDto })
  @ApiCreatedResponse({ description: 'The created payment method', type: PaymentMethodResponseDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'VALIDATION', 'CONFLICT', 'INTERNAL')
  async create(
    @CurrentUser() user: CurrentUserModel,
    @Body() body: CreatePaymentMethodDto,
  ): Promise<PaymentMethodResponseDto> {
    return toResponse(await this.createPaymentMethod.execute(user, body));
  }

  @RequiresGrant('settings', 'update')
  @Patch(':id')
  @ApiOperation({
    operationId: 'updatePaymentMethod',
    summary: 'Edit a payment method (settings grant)',
  })
  @ApiBody({ type: UpdatePaymentMethodDto })
  @ApiOkResponse({ description: 'The saved payment method', type: PaymentMethodResponseDto })
  @ApiErrorResponses(
    'UNAUTHENTICATED',
    'FORBIDDEN',
    'NOT_FOUND',
    'VALIDATION',
    'CONFLICT',
    'INTERNAL',
  )
  async update(
    @CurrentUser() user: CurrentUserModel,
    @Param('id') id: string,
    @Body() body: UpdatePaymentMethodDto,
  ): Promise<PaymentMethodResponseDto> {
    return toResponse(await this.updatePaymentMethod.execute(user, id, body));
  }
}

function toResponse(method: PaymentMethodOutput): PaymentMethodResponseDto {
  return {
    id: method.id,
    code: method.code,
    name: method.name,
    nameEn: method.nameEn,
    requiresReference: method.requiresReference,
    suggestsIgtf: method.suggestsIgtf,
    active: method.active,
  };
}
