import functools
import inspect


def require(*conditions):
    """Assert that the decorated function satisfies all conditions before it is called.

    This decorator is used to specify preconditions for a function. The conditions are specified as
    callables that take the same arguments as the function they decorate. If any of the conditions
    are not met, an AssertionError is raised.
    """
    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            bound_args = inspect.signature(func).bind(*args, **kwargs)
            bound_args.apply_defaults()
            func_args = bound_args.arguments

            # Evaluate conditions
            for condition in conditions:
                assert eval(condition, globals(), func_args), f"Precondition failed: {condition}"
            return func(*args, **kwargs)
        return wrapper
    return decorator


def ensure(*conditions):
    """Assert that the decorated function satisfies all conditions after it is called.

    This decorator is used to specify postconditions for a function. The conditions are specified
    as callables that take the result of the function followed by any function arguments and
    keyword arguments. If any of the conditions are not met, an AssertionError is raised.
    """
    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            result = func(*args, **kwargs)
            bound_args = inspect.signature(func).bind(*args, **kwargs)
            bound_args.apply_defaults()
            func_args = bound_args.arguments
            func_args["__result__"] = result  # Add result to func_args for postconditions

            # Evaluate conditions
            for condition in conditions:
                assert eval(condition, globals(), func_args), f"Postcondition failed: {condition}"
            return result
        return wrapper
    return decorator


def invariant(condition):
    """Assert that the decorated class satisfies the condition after every method call.

    This decorator is used to specify invariants for a class. The condition is specified as a
    callable that takes the instance of the class as its only argument. If the condition is not met
    after a method call, an AssertionError is raised.
    """
    def decorator(cls):
        # Wrap each method in the class to check the invariant after it is called.
        for name, method in cls.__dict__.items():
            if callable(method):
                setattr(cls, name, _wrap_method_with_invariant_check(method, condition))
        return cls
    return decorator


def _wrap_method_with_invariant_check(method, condition):
    @functools.wraps(method)
    def wrapper(self, *args, **kwargs):
        result = method(self, *args, **kwargs)
        # Prepare the namespace for eval by including instance attributes and the result
        namespace = {**self.__dict__, "self": self}
        assert eval(condition, globals(), namespace), f"Class invariant violated: {condition}"
        return result
    return wrapper
