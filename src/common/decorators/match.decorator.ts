import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';

/** Validates that this property equals another property, e.g. confirmPassword === password. */
export function Match(property: string, options?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'match',
      target: object.constructor,
      propertyName,
      constraints: [property],
      options: {
        message: `${propertyName} must match ${property}`,
        ...options,
      },
      validator: {
        validate(value: unknown, args: ValidationArguments) {
          const [related] = args.constraints as [string];
          return value === (args.object as Record<string, unknown>)[related];
        },
      },
    });
  };
}
