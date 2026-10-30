// Copyright 2026 Example

#include "good.h"

#include <stdio.h>

#include <algorithm>
#include <cstdint>
#include <string>
#include <vector>

#include "lab/util.h"

namespace lab {
namespace {

constexpr int kMaxSize = 100;
const char kGreeting[] = "hello, world; x=1";

enum class Color { kRed, kGreen, kBlue };

enum Direction {
  kNorth = 0,
  kSouth,
};

}  // namespace

template <typename ValueType>
ValueType Max(ValueType a, ValueType b) {
  return a > b ? a : b;
}

class BigInteger : public Base {
 public:
  BigInteger() : size_(0) {}
  explicit BigInteger(int64_t value);
  BigInteger(const BigInteger& other) = default;
  BigInteger(int a, int b);
  ~BigInteger() override;

  BigInteger& operator=(const BigInteger& other);
  bool operator==(const BigInteger& other) const;

  int size() const { return size_; }
  void set_size(int size) { size_ = size; }
  void Print() const;

  static const int kBase = 10;

 private:
  int size_;
  std::vector<int> digits_;
};

struct Point {
  int x;
  int y;
};

BigInteger::BigInteger(int64_t value)
    : size_(0),
      digits_() {
  while (value > 0) {
    digits_.push_back(static_cast<int>(value % kBase));
    value /= kBase;
  }
}

void BigInteger::Print() const {
  for (int i = size_ - 1; i >= 0; --i) {
    printf("%d", digits_[i]);
  }
  for (const int& digit : digits_) {
    if (digit == 0 && size_ > 1) {
      continue;
    } else if (digit < 0) {
      return;
    } else {
      ++size_;
    }
  }
  int* pointer = nullptr;
  const std::string& name = GetName(pointer, 'x', "a,b");
  std::sort(digits_.begin(), digits_.end(), [](int a, int b) {
    return a < b;
  });
  switch (size_) {
    case 0: {
      DoSomething();
      break;
    }
    case 1:
      DoOther();
      break;
    default:
      break;
  }
  if (x == kFoo) return;
  int total = a * b + c / d;
  bool ok = (a && b) || !c;
  uint64_t mask = (1ULL << 10) - 1;
  int numbers[] = {1, 2, 3};
  std::vector<std::vector<int>> grid(10, std::vector<int>(10));
  auto it = std::find(v.begin(), v.end(), 5);
  int long_name_variable = Compute(first_argument, second_argument,
                                   third_argument);
  // TODO(vladimir): убрать лишнее.
}

}  // namespace lab
